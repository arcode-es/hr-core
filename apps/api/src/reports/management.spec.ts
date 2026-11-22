import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { fromWallTime, wallTime } from '../common/tz';
import { png } from '../demo/assets';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp } from '../testing/boot';

const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

/** Texto de un PDF (para comprobar lo que se ha escrito en él). */
async function pdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as typeof import('pdfjs-dist');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  const page = await pdf.getPage(1);
  return (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
}

describe('Gestión: gestoría, coste por obra, marca y turnos rotativos', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let boss: string;
  let bossId: string;
  let orgId: string;
  const people: Record<'ana' | 'luis' | 'jefe', { token: string; id: string; membership: string }> = {} as never;
  const as = (token: string) => ({ ...bearer(token), 'X-Workspace': orgId });
  const month = '2031-02';
  const at = (day: number, hh: number, mm = 0) => fromWallTime({ year: 2031, month: 2, day, hour: hh, minute: mm }, 'Europe/Madrid');
  let obra: string;
  let nave: string;

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    prisma = app.get(PrismaService);
    const signUp = async (name: string) => {
      const email = `${name}.${run}@gestion.dev`;
      const res = await http.post('/api/v1/auth/register').send({ email, password: 'secreto-1234', fullName: `${name} Gestión` }).expect(201);
      return { token: res.body.accessToken as string, email };
    };
    boss = (await signUp('jefa')).token;
    bossId = (await http.get('/api/v1/me').set(bearer(boss))).body.user.id;
    orgId = (await http.post('/api/v1/organizations').set(bearer(boss)).send({ name: `Gestión ${run}` }).expect(201)).body.organizationId;
    for (const [name, role] of [['ana', 'EMPLOYEE'], ['luis', 'EMPLOYEE'], ['jefe', 'MANAGER']] as const) {
      const who = await signUp(name);
      const inv = await http.post('/api/v1/invitations').set(as(boss)).send({ email: who.email, role }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(who.token)).expect(200);
      const id = (await http.get('/api/v1/me').set(bearer(who.token))).body.user.id as string;
      const m = await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, userId: id } });
      people[name] = { token: who.token, id, membership: m.id };
    }
    await prisma.user.update({ where: { id: people.ana.id }, data: { dniNie: '12345678Z' } });
    obra = (await http.post('/api/v1/locations').set(as(boss)).send({ name: 'Obra Norte', latitude: 39.5, longitude: -0.4, geofenceRadiusMeters: 100 }).expect(201)).body.id;
    nave = (await http.post('/api/v1/locations').set(as(boss)).send({ name: 'Nave Sur', latitude: 39.4, longitude: -0.4, geofenceRadiusMeters: 100 }).expect(201)).body.id;

    // Ana: turno de 6 h el día 3 y 8 h trabajadas en la obra (2 h extra), una llegada tarde y vacaciones.
    // Luis: 4 h en la nave, sin coste por hora.
    const entry = (userId: string, locationId: string, start: Date, end: Date, lateMinutes: number | null = null) =>
      prisma.timeEntry.create({ data: { organizationId: orgId, userId, workdayId: randomUUID(), entryType: 'WORK', locationId, startTime: start, endTime: end, lateMinutes } });
    await prisma.shift.create({ data: { organizationId: orgId, userId: people.ana.id, date: new Date('2031-02-03T00:00:00Z'), plannedStart: at(3, 8), plannedEnd: at(3, 14), publishedAt: new Date(), createdById: bossId } });
    await entry(people.ana.id, obra, at(3, 8, 20), at(3, 16, 20), 20);
    await entry(people.luis.id, nave, at(4, 9), at(4, 13));
    await prisma.absence.create({ data: { organizationId: orgId, userId: people.ana.id, type: 'VACATION', startDate: new Date('2031-02-10T00:00:00Z'), endDate: new Date('2031-02-12T00:00:00Z'), days: 3, status: 'APPROVED' } });
    await prisma.expense.createMany({
      data: [
        { organizationId: orgId, userId: people.ana.id, locationId: obra, category: 'MEAL', amount: 12.5, date: new Date('2031-02-03T00:00:00Z'), status: 'APPROVED' },
        { organizationId: orgId, userId: people.ana.id, locationId: obra, category: 'MILEAGE', amount: 10.4, distanceKm: 40, date: new Date('2031-02-03T00:00:00Z'), status: 'REIMBURSED' },
        { organizationId: orgId, userId: people.ana.id, locationId: obra, category: 'FUEL', amount: 30, date: new Date('2031-02-04T00:00:00Z'), status: 'PENDING' },
      ],
    });
  });
  afterAll(() => app.close());

  const settings = async (extra: Record<string, unknown>) => {
    const { id: _i, currency: _c, hasLogo: _l, ...dto } = (await http.get('/api/v1/organization').set(as(boss))).body;
    return http.patch('/api/v1/organization').set(as(boss)).send({ ...dto, ...extra }).expect(200);
  };

  it('gestoría: una fila por persona en las columnas y el orden que elige la empresa', async () => {
    await http.get(`/api/v1/reports/payroll-export?month=${month}`).set(as(people.jefe.token)).expect(403);
    await settings({ payrollColumns: ['name', 'dni', 'workedDays', 'overtimeHours', 'vacationDays', 'lateCount', 'expenses', 'mileageKm', 'mileageAmount'] });
    const res = await http.get(`/api/v1/reports/payroll-export?month=${month}&format=csv`).set(as(boss)).expect(200);
    expect(res.headers['content-disposition']).toContain(`gestoria-${month}.csv`);
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n').map((l) => l.split(';'));
    expect(lines[0]).toEqual(['Nombre y apellidos', 'DNI/NIE', 'Días trabajados', 'Horas extra', 'Días de vacaciones', 'Retrasos', 'Gastos aprobados (€)', 'Kilometraje (km)', 'Kilometraje (€)']);
    expect(lines.find((l) => l[0] === 'ana Gestión')).toEqual(['ana Gestión', '12345678Z', '1', '2', '3', '1', '12,5', '40', '10,4']);
    expect(lines.find((l) => l[0] === 'luis Gestión')).toEqual(['luis Gestión', '', '1', '0', '0', '0', '0', '0', '0']);

    const xlsx = await binary(http.get(`/api/v1/reports/payroll-export?month=${month}&format=xlsx`).set(as(boss))).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as ArrayBuffer);
    const sheet = wb.getWorksheet('Gestoría')!;
    expect(sheet.getRow(4).values).toEqual([undefined, 'Nombre y apellidos', 'DNI/NIE', 'Días trabajados', 'Horas extra', 'Días de vacaciones', 'Retrasos', 'Gastos aprobados (€)', 'Kilometraje (km)', 'Kilometraje (€)']);
    await settings({ payrollColumns: ['name', 'name'] }).catch(() => undefined);
    const { id: _i, currency: _c, hasLogo: _l, ...dto } = (await http.get('/api/v1/organization').set(as(boss))).body;
    await http.patch('/api/v1/organization').set(as(boss)).send({ ...dto, payrollColumns: ['name', 'name'] }).expect(400);
  });

  it('coste por obra: horas por el coste de cada persona, con recargo de extra, y gastos aprobados', async () => {
    await http.patch(`/api/v1/members/${people.ana.membership}`).set(as(boss)).send({ hourlyCost: 20 }).expect(204);
    await settings({ overtimeSurchargePct: 50 });
    // El coste por hora solo lo ve la administración.
    const asManager = (await http.get('/api/v1/members').set(as(people.jefe.token)).expect(200)).body;
    expect(asManager.find((m: { userId: string }) => m.userId === people.ana.id).hourlyCost).toBeNull();
    expect((await http.get('/api/v1/members').set(as(boss)).expect(200)).body.find((m: { userId: string }) => m.userId === people.ana.id).hourlyCost).toBe(20);

    await http.get(`/api/v1/reports/sites?month=${month}`).set(as(people.jefe.token)).expect(403);
    const r = (await http.get(`/api/v1/reports/sites?month=${month}`).set(as(boss)).expect(200)).body;
    const norte = r.rows.find((x: { location: { name: string } | null }) => x.location?.name === 'Obra Norte');
    // 8 h × 20 € × (1 + 50 % × 2/8 de extra) = 180 €
    expect(norte).toMatchObject({ workedSeconds: 8 * 3600, people: 1, laborCost: 180, expenses: { MEAL: 12.5, MILEAGE: 10.4 }, expensesTotal: 22.9 });
    expect(r.rows.find((x: { location: { name: string } | null }) => x.location?.name === 'Nave Sur')).toMatchObject({ workedSeconds: 4 * 3600, laborCost: 0 });
    expect(r.missingRates).toEqual([{ id: people.luis.id, fullName: 'luis Gestión' }]);
    expect(r.total).toEqual({ workedSeconds: 12 * 3600, laborCost: 180, expensesTotal: 22.9 });
    const xlsx = await binary(http.get(`/api/v1/reports/sites.xlsx?month=${month}`).set(as(boss))).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as ArrayBuffer);
    expect(wb.getWorksheet('Coste por obra')!.getRow(5).getCell(1).value).toBe('Obra Norte');
  });

  it('marca del cliente: nombre, color y logotipo en la app y en los PDF', async () => {
    await settings({ brandName: 'Construcciones Norte', accentColor: '#0f766e' });
    const logo = png(80, 40, (x) => (x < 40 ? [15, 118, 110, 255] : [255, 255, 255, 0]));
    await http.post('/api/v1/organization/logo').set(as(boss)).attach('file', Buffer.from('<svg onload="alert(1)"/>'), 'logo.svg').expect(400).expect((r) => expect(r.body.code).toBe('LOGO_INVALID'));
    await http.post('/api/v1/organization/logo').set(as(people.jefe.token)).attach('file', logo, 'logo.png').expect(403);
    expect((await http.post('/api/v1/organization/logo').set(as(boss)).attach('file', logo, 'logo.png').expect(200)).body.hasLogo).toBe(true);
    const shown = await binary(http.get('/api/v1/organization/logo').set(as(people.ana.token))).expect(200);
    expect(shown.headers['content-type']).toBe('image/png');
    expect((shown.body as Buffer).equals(logo)).toBe(true);

    const me = (await http.get('/api/v1/me').set(bearer(people.ana.token)).expect(200)).body;
    expect(me.workspaces.find((w: { organizationId?: string }) => w.organizationId === orgId).branding).toEqual({ name: 'Construcciones Norte', accent: '#0f766e', logo: true });
    await settings({ accentColor: 'teal' }).catch(() => undefined);

    const pdf = await binary(http.get(`/api/v1/reports/timesheet?month=${month}&format=pdf`).set(as(people.ana.token))).expect(200);
    expect(await pdfText(pdf.body as Buffer)).toContain('Construcciones Norte');

    expect((await http.delete('/api/v1/organization/logo').set(as(boss)).expect(200)).body.hasLogo).toBe(false);
    await http.get('/api/v1/organization/logo').set(as(people.ana.token)).expect(404);
  });

  it('turnos rotativos: ciclo con desfase, hora local correcta en el cambio de hora y sin pisar festivos, ausencias ni turnos', async () => {
    const pattern = (
      await http
        .post('/api/v1/shift-patterns')
        .set(as(people.jefe.token))
        .send({ name: 'Mañana, mañana, noche, libre', days: [{ start: '07:00', end: '15:00', breakMinutes: 30, locationId: obra }, { start: '07:00', end: '15:00', breakMinutes: 30, locationId: obra }, { start: '22:00', end: '06:00', breakMinutes: 0, locationId: nave }, null] })
        .expect(201)
    ).body;
    await http.post('/api/v1/shift-patterns').set(as(boss)).send({ name: 'Mañana, mañana, noche, libre', days: [null, { start: '08:00', end: '12:00' }] }).expect(409);
    await http.post('/api/v1/shift-patterns').set(as(boss)).send({ name: 'Todo libre', days: [null, null] }).expect(400);
    await http.get('/api/v1/shift-patterns').set(as(people.ana.token)).expect(403);

    // Semana del cambio de hora (domingo 30 de marzo de 2031). Un festivo el miércoles 26 en la nave,
    // vacaciones de Luis el jueves 27 y un turno que ya tenía Ana el martes 25.
    await prisma.holiday.create({ data: { organizationId: orgId, date: new Date('2031-03-26T00:00:00Z'), name: 'Fiesta de la nave', scope: 'LOCAL', locationId: nave } });
    await prisma.absence.create({ data: { organizationId: orgId, userId: people.luis.id, type: 'VACATION', startDate: new Date('2031-03-27T00:00:00Z'), endDate: new Date('2031-03-27T00:00:00Z'), days: 1, status: 'APPROVED' } });
    await prisma.shift.create({ data: { organizationId: orgId, userId: people.ana.id, date: new Date('2031-03-25T00:00:00Z'), plannedStart: new Date('2031-03-25T09:00:00Z'), plannedEnd: new Date('2031-03-25T11:00:00Z'), createdById: bossId } });

    const result = (await http.post(`/api/v1/shift-patterns/${pattern.id}/apply`).set(as(people.jefe.token)).send({ userIds: [people.ana.id, people.luis.id], startDate: '2031-03-24', weeks: 1, stagger: 1 }).expect(200)).body;
    // Ana: L24 M, M25 M (choca), X26 N (festivo en la nave), J27 libre, V28 M, S29 M, D30 N  → 4 creados
    // Luis (un día por delante): L24 M, M25 N, X26 libre, J27 M (vacaciones), V28 M, S29 N, D30 libre → 4 creados
    expect(result).toEqual({ created: 8, skipped: { holiday: 1, absence: 1, overlap: 1 } });

    const shifts = await prisma.shift.findMany({ where: { organizationId: orgId, notes: pattern.name }, orderBy: { plannedStart: 'asc' } });
    expect(shifts.every((s) => s.publishedAt === null)).toBe(true);
    const local = (d: Date) => {
      const w = wallTime(d, 'Europe/Madrid');
      return `${String(w.day).padStart(2, '0')} ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
    };
    const ana = shifts.filter((s) => s.userId === people.ana.id).map((s) => `${local(s.plannedStart)}-${local(s.plannedEnd)}`);
    expect(ana).toEqual(['24 07:00-24 15:00', '28 07:00-28 15:00', '29 07:00-29 15:00', '30 22:00-31 06:00']);
    // Antes y después del cambio de hora, las 07:00 locales son instantes UTC distintos.
    const mondays = shifts.filter((s) => s.userId === people.ana.id).map((s) => s.plannedStart.toISOString().slice(11, 16));
    expect(mondays.slice(0, 3)).toEqual(['06:00', '06:00', '06:00']);
    expect(shifts.find((s) => s.userId === people.luis.id && local(s.plannedStart).startsWith('29'))!.plannedEnd.toISOString()).toBe('2031-03-30T04:00:00.000Z'); // 06:00 de verano
    await http.delete(`/api/v1/shift-patterns/${pattern.id}`).set(as(boss)).expect(204);
  });
});
