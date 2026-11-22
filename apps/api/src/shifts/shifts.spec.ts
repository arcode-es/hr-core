import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { GeoService } from '../geo/geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { setupApp } from '../setup';

describe('Cuadrantes y bolsas de horas', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);

  let boss: string;
  let worker: string;
  let orgId: string;
  let workerId: string;
  let bossId: string;
  let solId: string;
  let almacenId: string;

  const as = (token: string, ws?: string) => ({ Authorization: `Bearer ${token}`, ...(ws ? { 'X-Workspace': ws } : {}) });
  const signUp = async (name: string): Promise<string> =>
    (await http.post('/api/v1/auth/register').send({ email: `${name}.${run}@shift.dev`, password: 'secreto-1234', fullName: name }).expect(201))
      .body.accessToken;
  // Semana fija de invierno en Madrid (UTC+1): lunes 2 de marzo de 2026.
  const madrid = (day: number, hhmm: string, month = 3): string =>
    new Date(Date.parse(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hhmm}:00Z`) - 3600_000).toISOString();
  const week = { from: madrid(2, '00:00'), to: madrid(9, '00:00') };
  const shift = (userId: string, day: number, from: string, to: string, extra: Record<string, unknown> = {}) => ({
    userId,
    start: madrid(day, from),
    end: madrid(day, to),
    breakMinutes: 0,
    ...extra,
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GeoService)
      .useValue({ reverse: async () => null, search: async () => [] })
      .compile();
    app = mod.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    boss = await signUp('jefa');
    worker = await signUp('obrero');
    orgId = (await http.post('/api/v1/organizations').set(as(boss)).send({ name: `Turnos ${run}` }).expect(201)).body.organizationId;
    const inv = await http.post('/api/v1/invitations').set(as(boss, orgId)).send({ email: `obrero.${run}@shift.dev` }).expect(201);
    await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(as(worker)).expect(200);
    workerId = (await http.get('/api/v1/me').set(as(worker))).body.user.id;
    bossId = (await http.get('/api/v1/me').set(as(boss))).body.user.id;
    const loc = (name: string, latitude: number) =>
      http.post('/api/v1/locations').set(as(boss, orgId)).send({ name, latitude, longitude: -3.7038, geofenceRadiusMeters: 100 }).expect(201);
    solId = (await loc('Obra Sol', 40.4168)).body.id;
    almacenId = (await loc('Almacén', 40.4268)).body.id; // ≈1,1 km al norte
  });

  afterAll(() => app.close());

  it('solo quien planifica crea turnos; se valida el rango', async () => {
    await http.post('/api/v1/shifts').set(as(worker, orgId)).send({ shifts: [shift(workerId, 2, '08:00', '16:00')] }).expect(403);
    const bad = (s: object) => http.post('/api/v1/shifts').set(as(boss, orgId)).send({ shifts: [s] });
    expect((await bad(shift(workerId, 2, '16:00', '08:00')).expect(400)).body.code).toBe('INVALID_RANGE');
    expect((await bad(shift(workerId, 2, '08:00', '09:00', { breakMinutes: 60 })).expect(400)).body.code).toBe('INVALID_RANGE');
    await bad(shift(randomUUID(), 2, '08:00', '16:00')).expect(404);
  });

  it('crea de lunes a viernes de una vez, como borrador', async () => {
    const res = await http
      .post('/api/v1/shifts')
      .set(as(boss, orgId))
      .send({ shifts: [2, 3, 4, 5, 6].map((d) => shift(workerId, d, '08:00', '16:00', { breakMinutes: 30, locationId: solId })) })
      .expect(201);
    expect(res.body).toHaveLength(5);
    expect(res.body[0]).toMatchObject({ date: '2026-03-02', published: false, locationName: 'Obra Sol', breakMinutes: 30, user: { fullName: 'obrero' } });
  });

  it('no admite dos turnos solapados, pero sí un turno partido', async () => {
    const overlap = await http.post('/api/v1/shifts').set(as(boss, orgId)).send({ shifts: [shift(workerId, 2, '15:00', '20:00')] }).expect(409);
    expect(overlap.body.code).toBe('OVERLAP');
    await http.post('/api/v1/shifts').set(as(boss, orgId)).send({ shifts: [shift(workerId, 2, '18:00', '21:00')] }).expect(201);
  });

  it('el día del turno es el local: uno que empieza a las 00:30 de Madrid no cae en la víspera', async () => {
    const res = await http.post('/api/v1/shifts').set(as(boss, orgId)).send({ shifts: [shift(bossId, 7, '00:30', '06:00')] }).expect(201);
    expect(res.body[0].plannedStart).toBe('2026-03-06T23:30:00.000Z');
    expect(res.body[0].date).toBe('2026-03-07');
  });

  it('el empleado no ve los borradores; al publicar, sí', async () => {
    const before = await http.get('/api/v1/shifts').query(week).set(as(worker, orgId)).expect(200);
    expect(before.body).toEqual([]);
    await http.post('/api/v1/shifts/publish').set(as(worker, orgId)).send(week).expect(403);
    const pub = await http.post('/api/v1/shifts/publish').set(as(boss, orgId)).send(week).expect(200);
    expect(pub.body.published).toBe(7);
    const after = await http.get('/api/v1/shifts').query(week).set(as(worker, orgId)).expect(200);
    expect(after.body).toHaveLength(6); // los suyos, no el de la jefa
    expect(after.body.every((s: { user: { id: string } }) => s.user.id === workerId)).toBe(true);
    const all = await http.get('/api/v1/shifts').query(week).set(as(boss, orgId)).expect(200);
    expect(all.body).toHaveLength(7);
  });

  it('copia la semana a otra conservando la hora local a través del cambio de hora, sin duplicar', async () => {
    // 2–8 de marzo → 30 de marzo–5 de abril (+28 días): en medio se adelanta el reloj (29 de marzo).
    const res = await http.post('/api/v1/shifts/copy').set(as(boss, orgId)).send({ ...week, offsetDays: 28 }).expect(200);
    expect(res.body).toEqual({ copied: 7, skipped: 0 });
    const target = { from: '2026-03-29T22:00:00.000Z', to: '2026-04-05T22:00:00.000Z' };
    const copied = await http.get('/api/v1/shifts').query(target).set(as(boss, orgId)).expect(200);
    const monday = copied.body.find((s: { date: string; plannedStart: string }) => s.date === '2026-03-30' && s.plannedStart.includes('T06:00'));
    // 08:00 en horario de verano (UTC+2) es 06:00 UTC: sigue siendo un turno de 08:00.
    expect(monday).toMatchObject({ plannedStart: '2026-03-30T06:00:00.000Z', plannedEnd: '2026-03-30T14:00:00.000Z', published: false });
    const again = await http.post('/api/v1/shifts/copy').set(as(boss, orgId)).send({ ...week, offsetDays: 28 }).expect(200);
    expect(again.body).toEqual({ copied: 0, skipped: 7 });
  });

  it('editar y borrar un turno', async () => {
    const list = await http.get('/api/v1/shifts').query(week).set(as(boss, orgId)).expect(200);
    const friday = list.body.find((s: { date: string }) => s.date === '2026-03-06');
    const upd = await http
      .patch(`/api/v1/shifts/${friday.id}`)
      .set(as(boss, orgId))
      .send({ start: madrid(6, '07:00'), end: madrid(6, '15:00'), breakMinutes: 0, locationId: almacenId, notes: 'Descarga de material' })
      .expect(200);
    expect(upd.body).toMatchObject({ locationName: 'Almacén', notes: 'Descarga de material' });
    await http.patch(`/api/v1/shifts/${friday.id}`).set(as(worker, orgId)).send({ start: madrid(6, '07:00'), end: madrid(6, '15:00'), breakMinutes: 0 }).expect(403);
    const split = list.body.find((s: { plannedStart: string }) => s.plannedStart === madrid(2, '18:00'));
    await http.delete(`/api/v1/shifts/${split.id}`).set(as(boss, orgId)).expect(204);
    await http.delete(`/api/v1/shifts/${split.id}`).set(as(boss, orgId)).expect(404);
  });

  it('bolsa de horas: ordinarias hasta lo planificado, extra el resto, nocturnas aparte; lo pendiente no cuenta', async () => {
    const manual = (token: string, b: object) => http.post('/api/v1/time/manual').set(as(token, orgId)).send({ breaks: [], reason: 'Registro de prueba', ...b });
    // Lunes: turno 08–16 con 30 min de pausa (7,5 h). Trabaja 08–18 con 30 min de pausa → 9,5 h.
    await manual(boss, {
      userId: workerId,
      start: madrid(2, '08:00'),
      end: madrid(2, '18:00'),
      breaks: [{ kind: 'MEAL', start: madrid(2, '13:00'), end: madrid(2, '13:30') }],
    }).expect(201);
    // Domingo, sin turno: 21:00–23:30 → todo extra, 1,5 h nocturnas.
    await manual(boss, { userId: workerId, start: madrid(8, '21:00'), end: madrid(8, '23:30') }).expect(201);
    // Martes: lo declara el empleado → pendiente, no cuenta.
    await manual(worker, { start: madrid(3, '08:00'), end: madrid(3, '16:00') }).expect(201);

    const mine = await http.get('/api/v1/time/hours').query(week).set(as(worker, orgId)).expect(200);
    expect(mine.body).toHaveLength(1);
    const H = 3600;
    expect(mine.body[0].hasPlan).toBe(true);
    expect(mine.body[0].total).toMatchObject({
      plannedSeconds: 4 * 7.5 * H + 8 * H, // lunes a jueves 7,5 h + viernes editado 8 h
      workedSeconds: 12 * H,
      ordinarySeconds: 7.5 * H,
      overtimeSeconds: 4.5 * H,
      nightSeconds: 1.5 * H,
      breakSeconds: 0.5 * H,
    });
    const days = Object.fromEntries(mine.body[0].days.map((d: { date: string }) => [d.date, d]));
    expect(days['2026-03-02']).toMatchObject({ ordinarySeconds: 7.5 * H, overtimeSeconds: 2 * H });
    expect(days['2026-03-08']).toMatchObject({ ordinarySeconds: 0, overtimeSeconds: 2.5 * H, nightSeconds: 1.5 * H });
    expect(days['2026-03-03']).toMatchObject({ workedSeconds: 0, plannedSeconds: 7.5 * H });

    await http.get('/api/v1/time/hours').query({ ...week, scope: 'team' }).set(as(worker, orgId)).expect(403);
    const team = await http.get('/api/v1/time/hours').query({ ...week, scope: 'team' }).set(as(boss, orgId)).expect(200);
    expect(team.body.map((u: { user: { fullName: string } }) => u.user.fullName)).toEqual(['jefa', 'obrero']);
  });

  it('con turno asignado, la geocerca es la de su ubicación, no la más cercana', async () => {
    const now = Date.now();
    await http
      .post('/api/v1/shifts')
      .set(as(boss, orgId))
      .send({ shifts: [{ userId: workerId, start: new Date(now - 3600_000).toISOString(), end: new Date(now + 4 * 3600_000).toISOString(), breakMinutes: 0, locationId: solId }] })
      .expect(201);
    const today = { from: new Date(now - 86_400_000).toISOString(), to: new Date(now + 86_400_000).toISOString() };
    const atAlmacen = { lat: 40.4268, lng: -3.7038, accuracy: 5 };

    // Borrador: aún no cuenta, se usa la ubicación más cercana (está dentro del Almacén).
    const draft = await http.get('/api/v1/time/geofence').query(atAlmacen).set(as(worker, orgId)).expect(200);
    expect(draft.body.match).toMatchObject({ within: true, location: { name: 'Almacén' } });
    expect((await http.get('/api/v1/time/status').set(as(worker, orgId))).body.shift).toBeNull();

    await http.post('/api/v1/shifts/publish').set(as(boss, orgId)).send(today).expect(200);
    const assigned = await http.get('/api/v1/time/geofence').query(atAlmacen).set(as(worker, orgId)).expect(200);
    expect(assigned.body.match).toMatchObject({ within: false, location: { name: 'Obra Sol' } });
    expect(assigned.body.match.outsideByMeters).toBeGreaterThan(950);

    const status = await http.get('/api/v1/time/status').set(as(worker, orgId)).expect(200);
    expect(status.body.shift).toMatchObject({ locationName: 'Obra Sol', published: true });

    const data = JSON.stringify({ action: 'START', position: atAlmacen, clientTime: new Date().toISOString(), clientUuid: randomUUID() });
    const res = await http.post('/api/v1/time/clock').set(as(worker, orgId)).field('data', data).expect(200);
    expect(res.body.workday.segments[0]).toMatchObject({ locationName: 'Obra Sol', isWithinGeofence: false });
    const row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: res.body.workday.segments[0].id } });
    expect(row.shiftId).toBe(status.body.shift.id);
  });

  it('en el espacio personal cada uno planifica lo suyo y queda visible sin publicar', async () => {
    const res = await http.post('/api/v1/shifts').set(as(worker)).send({ shifts: [shift(workerId, 2, '08:00', '14:00')] }).expect(201);
    expect(res.body[0].published).toBe(true);
    await http.post('/api/v1/shifts').set(as(worker)).send({ shifts: [shift(bossId, 2, '08:00', '14:00')] }).expect(403);
    const mine = await http.get('/api/v1/shifts').query(week).set(as(worker)).expect(200);
    expect(mine.body).toHaveLength(1);
  });
});
