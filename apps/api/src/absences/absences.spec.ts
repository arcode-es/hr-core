import type { INestApplication } from '@nestjs/common';
import { absenceDays } from '@hr/shared';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { textPdf } from '../demo/assets';
import { bearer, bootApp } from '../testing/boot';
import { HolidaysProvider, type OfficialHoliday } from './holidays.provider';

describe('Cuenta de días de una ausencia', () => {
  const holidays = new Set(['2031-03-05']);
  it('laborables: sin fines de semana ni festivos; naturales: todos; medio día: 0,5', () => {
    expect(absenceDays('2031-03-03', '2031-03-09', 'WORKING', holidays)).toBe(4); // lunes a domingo, con un festivo
    expect(absenceDays('2031-03-03', '2031-03-09', 'NATURAL', holidays)).toBe(7);
    expect(absenceDays('2031-03-04', '2031-03-04', 'WORKING', holidays, true)).toBe(0.5);
    expect(absenceDays('2031-03-08', '2031-03-08', 'WORKING', holidays)).toBe(0); // sábado
  });
});

/** Festivos oficiales de mentira: no se depende de internet en los tests. */
class FakeHolidays extends HolidaysProvider {
  calls: string[] = [];
  async fetch(year: number, region: string): Promise<OfficialHoliday[]> {
    this.calls.push(`${year}:${region}`);
    return [
      { date: `${year}-01-01`, name: 'Año Nuevo', scope: 'NATIONAL' },
      { date: `${year}-03-05`, name: 'Fiesta de prueba', scope: 'NATIONAL' },
      ...(region === 'ES-VC' ? [{ date: `${year}-03-19`, name: 'San José', scope: 'REGIONAL' as const }] : []),
    ];
  }
}

describe('Festivos y ausencias', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const fake = new FakeHolidays();
  const run = randomUUID().slice(0, 8);
  const pw = 'secreto-1234';
  let boss: string;
  let worker: string;
  let inspector: string;
  let workerId: string;
  let orgId: string;
  let locationId: string;
  const as = (token: string) => ({ ...bearer(token), 'X-Workspace': orgId });

  const signUp = async (name: string) => {
    const email = `${name}.${run}@test.dev`;
    const res = await http.post('/api/v1/auth/register').send({ email, password: pw, fullName: `${name} Calendario` }).expect(201);
    return { token: res.body.accessToken as string, email };
  };
  const join = async (name: string, role: string) => {
    const who = await signUp(name);
    const inv = await http.post('/api/v1/invitations').set(as(boss)).send({ email: who.email, role }).expect(201);
    await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(who.token)).expect(200);
    return who.token;
  };
  const ask = (token: string, data: object, file?: Buffer) => {
    const r = http.post('/api/v1/absences').set(as(token)).field('data', JSON.stringify(data));
    return file ? r.attach('attachment', file, 'justificante.pdf') : r;
  };

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }, (b) => b.overrideProvider(HolidaysProvider).useValue(fake)));
    boss = (await signUp('jefa')).token;
    orgId = (await http.post('/api/v1/organizations').set(bearer(boss)).send({ name: `Calendario ${run}` }).expect(201)).body.organizationId;
    worker = await join('obrero', 'EMPLOYEE');
    inspector = await join('inspectora', 'INSPECTOR');
    workerId = (await http.get('/api/v1/me').set(bearer(worker))).body.user.id;
    locationId = (await http.post('/api/v1/locations').set(as(boss)).send({ name: 'Nave de Paterna', latitude: 39.52, longitude: -0.44, geofenceRadiusMeters: 200 }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('importa los festivos nacionales y los de la comunidad elegida, sin duplicar', async () => {
    const org = (await http.get('/api/v1/organization').set(as(boss))).body;
    const { id: _i, currency: _c, ...dto } = org;
    await http.patch('/api/v1/organization').set(as(boss)).send({ ...dto, region: 'ES-VC' }).expect(200);
    expect((await http.post('/api/v1/holidays/import').set(as(boss)).send({ year: 2031 }).expect(201)).body).toEqual({ imported: 3, skipped: 0 });
    expect((await http.post('/api/v1/holidays/import').set(as(boss)).send({ year: 2031 }).expect(201)).body).toEqual({ imported: 0, skipped: 3 });
    expect(fake.calls.at(-1)).toBe('2031:ES-VC');
    // Uno local, solo para la nave (otro municipio).
    await http.post('/api/v1/holidays').set(as(boss)).send({ date: '2031-03-06', name: 'Fiesta local', scope: 'LOCAL', locationId }).expect(201);
    const list = await http.get('/api/v1/holidays?year=2031').set(as(worker)).expect(200);
    expect(list.body.map((h: { name: string }) => h.name)).toEqual(['Año Nuevo', 'Fiesta de prueba', 'Fiesta local', 'San José']);
    expect(list.body.find((h: { name: string }) => h.name === 'Fiesta local').location.name).toBe('Nave de Paterna');
    await http.post('/api/v1/holidays').set(as(worker)).send({ date: '2031-04-01', name: 'No', scope: 'NATIONAL' }).expect(403);
  });

  it('pedir vacaciones: cuenta laborables, avisa de turnos y el responsable puede quitarlos al aprobar', async () => {
    // Turnos publicados de lunes a viernes de esa semana.
    const shifts = ['03', '04', '05', '06', '07'].map((d) => ({ userId: workerId, start: `2031-03-${d}T07:00:00Z`, end: `2031-03-${d}T15:00:00Z`, breakMinutes: 30, locationId }));
    await http.post('/api/v1/shifts').set(as(boss)).send({ shifts }).expect(201);
    await http.post('/api/v1/shifts/publish').set(as(boss)).send({ from: '2031-03-01T00:00:00Z', to: '2031-03-10T00:00:00Z' }).expect(200);

    const req = await ask(worker, { type: 'VACATION', startDate: '2031-03-03', endDate: '2031-03-07', reason: 'Viaje familiar' }).expect(201);
    expect(req.body).toMatchObject({ status: 'PENDING', days: 4, conflictingShifts: 5 });
    await ask(worker, { type: 'PERSONAL', startDate: '2031-03-07', endDate: '2031-03-07' }).expect(409);

    const pending = await http.get('/api/v1/absences/pending').set(as(boss)).expect(200);
    expect(pending.body.map((a: { id: string }) => a.id)).toContain(req.body.id);
    await http.post(`/api/v1/absences/${req.body.id}/review`).set(as(boss)).send({ decision: 'REJECT', reason: 'no' }).expect(400);
    const approved = await http.post(`/api/v1/absences/${req.body.id}/review`).set(as(boss)).send({ decision: 'APPROVE', removeShifts: true }).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', conflictingShifts: 0 });

    const notes = (await http.get('/api/v1/notifications').set(bearer(worker))).body.items.map((n: { type: string }) => n.type);
    expect(notes).toEqual(expect.arrayContaining(['ABSENCE_REVIEWED', 'SHIFT_UPDATED']));
    const balance = await http.get('/api/v1/absences/balance?year=2031').set(as(worker)).expect(200);
    expect(balance.body).toEqual({ year: 2031, allowance: 22, unit: 'WORKING', used: 4, pending: 0, remaining: 18 });
  });

  it('la bolsa de horas no cuenta como previstos los festivos ni las ausencias', async () => {
    const shifts = ['10', '11', '12'].map((d) => ({ userId: workerId, start: `2031-03-${d}T07:00:00Z`, end: `2031-03-${d}T15:00:00Z`, breakMinutes: 0 }));
    await http.post('/api/v1/shifts').set(as(boss)).send({ shifts }).expect(201);
    await http.post('/api/v1/shifts/publish').set(as(boss)).send({ from: '2031-03-10T00:00:00Z', to: '2031-03-13T00:00:00Z' }).expect(200);
    await http.post('/api/v1/holidays').set(as(boss)).send({ date: '2031-03-11', name: 'Festivo de prueba', scope: 'LOCAL' }).expect(201);
    await ask(boss, { type: 'SICK_LEAVE', startDate: '2031-03-12', endDate: '2031-03-12', userId: workerId }).expect(201);

    const res = await http.get('/api/v1/time/hours?from=2031-03-09T23:00:00Z&to=2031-03-12T23:00:00Z&scope=me').set(as(worker)).expect(200);
    const mine = res.body[0];
    expect(mine.total.plannedSeconds).toBe(8 * 3600); // solo el día 10
    expect(mine.total.absenceSeconds).toBe(8 * 3600); // el 12, de baja
    expect(mine.absenceDays).toEqual({ SICK_LEAVE: 1 });
    expect(mine.holidays).toBe(1);
  });

  it('justificante adjunto, permisos de cada rol y anular', async () => {
    const pdf = await textPdf('Parte de baja', 'Centro de salud', ['Documento de prueba.']);
    const sick = await ask(worker, { type: 'SICK_LEAVE', startDate: '2031-04-01', endDate: '2031-04-02' }, pdf).expect(201);
    expect(sick.body).toMatchObject({ hasAttachment: true, days: 2, status: 'PENDING' });
    expect((await http.get(`/api/v1/absences/${sick.body.id}/attachment`).set(as(boss)).expect(200)).body.url).toBeTruthy();
    // La inspección consulta el calendario del equipo, pero no pide ni aprueba.
    const cal = await http.get('/api/v1/absences/calendar?from=2031-03-01&to=2031-04-30').set(as(inspector)).expect(200);
    expect(cal.body.absences.length).toBeGreaterThanOrEqual(2);
    await ask(inspector, { type: 'VACATION', startDate: '2031-05-01', endDate: '2031-05-02' }).expect(403);
    await http.post(`/api/v1/absences/${sick.body.id}/review`).set(as(inspector)).send({ decision: 'APPROVE' }).expect(403);
    // El empleado no registra ausencias de otros; la responsable las suyas quedan aprobadas.
    await ask(worker, { type: 'VACATION', startDate: '2031-05-01', endDate: '2031-05-01', userId: randomUUID() }).expect(403);
    const own = await ask(boss, { type: 'PERSONAL', startDate: '2031-05-05', endDate: '2031-05-05' }).expect(201);
    expect(own.body.status).toBe('APPROVED');
    // Anular: lo pendiente, sí; dos veces, no.
    await http.post(`/api/v1/absences/${sick.body.id}/cancel`).set(as(worker)).expect(200);
    await http.post(`/api/v1/absences/${sick.body.id}/cancel`).set(as(worker)).expect(409);
  });
});
