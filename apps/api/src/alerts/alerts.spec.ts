import type { INestApplication } from '@nestjs/common';
import { resolveSettings } from '@hr/shared';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { fromWallTime, wallTime } from '../common/tz';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp } from '../testing/boot';
import { AlertsService } from './alerts.service';

const H = 3_600_000;

describe('Alertas de jornada', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let alerts: AlertsService;
  const run = randomUUID().slice(0, 8);
  let boss: string;
  let bossId: string;
  let orgId: string;
  const people: Record<string, { token: string; id: string }> = {};
  const now = new Date();
  const as = (token: string) => ({ ...bearer(token), 'X-Workspace': orgId });
  const settings = async () => resolveSettings((await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).settings);
  const signUp = async (name: string) => {
    const email = `${name}.${run}@alerts.dev`;
    const res = await http.post('/api/v1/auth/register').send({ email, password: 'secreto-1234', fullName: `${name} Alerta` }).expect(201);
    return { token: res.body.accessToken as string, email };
  };
  const entry = (userId: string, start: Date, end: Date | null, workdayId = randomUUID()) =>
    prisma.timeEntry.create({ data: { organizationId: orgId, userId, workdayId, entryType: 'WORK', startTime: start, endTime: end } });
  const shift = (userId: string, start: Date, end: Date) =>
    prisma.shift.create({
      data: { organizationId: orgId, userId, date: new Date(`${start.toISOString().slice(0, 10)}T00:00:00Z`), plannedStart: start, plannedEnd: end, publishedAt: new Date(), createdById: bossId },
    });
  const notes = (userId: string) => prisma.notification.findMany({ where: { userId, type: 'ALERT', organizationId: orgId }, orderBy: { createdAt: 'asc' } });
  const alertsOf = (userId: string) => prisma.alert.findMany({ where: { userId, organizationId: orgId } });

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    prisma = app.get(PrismaService);
    alerts = app.get(AlertsService);
    boss = (await signUp('jefa')).token;
    bossId = (await http.get('/api/v1/me').set(bearer(boss))).body.user.id;
    orgId = (await http.post('/api/v1/organizations').set(bearer(boss)).send({ name: `Alertas ${run}` }).expect(201)).body.organizationId;
    for (const name of ['ana', 'bea', 'carla', 'dani', 'eva', 'fran']) {
      const who = await signUp(name);
      const inv = await http.post('/api/v1/invitations').set(as(boss)).send({ email: who.email }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(who.token)).expect(200);
      people[name] = { token: who.token, id: (await http.get('/api/v1/me').set(bearer(who.token))).body.user.id };
    }
  });
  afterAll(() => app.close());

  it('entrada sin fichar: avisa a la persona y, si sigue sin fichar al doble de tiempo, a quien supervisa', async () => {
    const s = await settings();
    const ana = people.ana!;
    const fran = people.fran!;
    await shift(ana.id, new Date(now.getTime() - 40 * 60_000), new Date(now.getTime() + 7 * H));
    // Fran tiene turno pero ya ha fichado: sin alerta.
    await shift(fran.id, new Date(now.getTime() - 40 * 60_000), new Date(now.getTime() + 7 * H));
    await entry(fran.id, new Date(now.getTime() - 45 * 60_000), null);

    await alerts.missedClockIns(orgId, s, now);
    expect(await alertsOf(ana.id)).toEqual([expect.objectContaining({ kind: 'MISSED_CLOCK_IN', resolvedAt: null })]);
    expect((await alertsOf(fran.id)).filter((a) => a.kind === 'MISSED_CLOCK_IN')).toEqual([]);
    expect((await notes(ana.id)).map((n) => n.payload)).toEqual([expect.objectContaining({ alertKind: 'MISSED_CLOCK_IN', link: '/clock' })]);
    expect(await notes(bossId)).toEqual([]);

    await alerts.missedClockIns(orgId, s, now); // otra pasada: nada nuevo
    expect(await notes(ana.id)).toHaveLength(1);

    const later = new Date(now.getTime() + 25 * 60_000); // 65 min: más del doble de 30
    await alerts.missedClockIns(orgId, s, later);
    await alerts.missedClockIns(orgId, s, later);
    const bossNotes = await notes(bossId);
    expect(bossNotes.map((n) => n.payload)).toEqual([expect.objectContaining({ alertKind: 'MISSED_CLOCK_IN', name: 'ana Alerta', link: '/alerts' })]);
    expect((await alertsOf(ana.id))[0]!.data).toMatchObject({ escalated: true });
  });

  it('no avisa de un turno en un día de ausencia aprobada', async () => {
    const s = await settings();
    const bea = people.bea!;
    await shift(bea.id, new Date(now.getTime() - 50 * 60_000), new Date(now.getTime() + 6 * H));
    const today = now.toISOString().slice(0, 10);
    await prisma.absence.create({ data: { organizationId: orgId, userId: bea.id, type: 'VACATION', startDate: new Date(`${today}T00:00:00Z`), endDate: new Date(`${today}T00:00:00Z`), days: 1, status: 'APPROVED' } });
    await alerts.missedClockIns(orgId, s, now);
    expect(await alertsOf(bea.id)).toEqual([]);
  });

  it('jornada abierta más de 10 h: avisa a la persona y, a las 14 h, a quien supervisa', async () => {
    const s = await settings();
    const carla = people.carla!;
    await entry(carla.id, new Date(now.getTime() - 11 * H), null);
    await alerts.longWorkdays(orgId, s, now);
    expect((await alertsOf(carla.id)).map((a) => a.kind)).toEqual(['LONG_WORKDAY']);
    expect((await notes(carla.id)).map((n) => n.payload)).toEqual([expect.objectContaining({ alertKind: 'LONG_WORKDAY', hours: 10 })]);
    const before = (await notes(bossId)).length;
    await alerts.longWorkdays(orgId, s, new Date(now.getTime() + 3.5 * H));
    expect(await notes(bossId)).toHaveLength(before + 1);
    expect((await notes(bossId)).at(-1)!.payload).toMatchObject({ alertKind: 'LONG_WORKDAY', hours: 14, name: 'carla Alerta' });
  });

  it('menos de 12 h de descanso entre jornadas: avisa a quien supervisa', async () => {
    const s = await settings();
    const dani = people.dani!;
    await entry(dani.id, new Date(now.getTime() - 22 * H), new Date(now.getTime() - 14 * H));
    await entry(dani.id, new Date(now.getTime() - 6 * H), new Date(now.getTime() - 1 * H));
    const before = (await notes(bossId)).length;
    await alerts.shortRests(orgId, s, now);
    await alerts.shortRests(orgId, s, now);
    expect((await alertsOf(dani.id)).map((a) => [a.kind, a.data])).toEqual([['SHORT_REST', { hours: 8 }]]);
    expect(await notes(bossId)).toHaveLength(before + 1);
    expect(await notes(dani.id)).toEqual([]); // a la persona no: no puede hacer nada ya
  });

  it('cada día: más de 9 h ordinarias ayer y horas extra del año al 70 %', async () => {
    const org = (await http.get('/api/v1/organization').set(as(boss))).body;
    const { id: _i, currency: _c, ...dto } = org;
    await http.patch('/api/v1/organization').set(as(boss)).send({ ...dto, overtimeYearLimit: 5 }).expect(200);
    const s = await settings();
    const t = wallTime(now, s.timezone);
    const yesterday = (h: number, m = 0) => fromWallTime({ ...t, day: t.day - 1, hour: h, minute: m }, s.timezone);

    const eva = people.eva!;
    await entry(eva.id, yesterday(7), yesterday(17, 30)); // 10,5 h sin turnos: todo ordinario

    const ana = people.ana!; // turno de 4 h y 8 h trabajadas: 4 h extra = 80 % de 5
    await shift(ana.id, yesterday(8), yesterday(12));
    await entry(ana.id, yesterday(8), yesterday(16));

    await alerts.longOrdinaryDays(orgId, s, now);
    await alerts.overtimeYear(orgId, s, now);
    expect((await alertsOf(eva.id)).map((a) => [a.kind, a.data])).toEqual([['LONG_ORDINARY_DAY', { hours: 10.5 }]]);
    const overtime = (await alertsOf(ana.id)).filter((a) => a.kind.startsWith('OVERTIME'));
    expect(overtime.map((a) => [a.kind, a.data])).toEqual([['OVERTIME_YEAR_70', { hours: 4, limit: 5 }]]);
  });

  it('quien supervisa las ve y las resuelve; el panel cuenta las abiertas', async () => {
    await http.get('/api/v1/alerts').set(as(people.ana!.token)).expect(403);
    const open = (await http.get('/api/v1/alerts').set(as(boss)).expect(200)).body;
    expect(open.length).toBeGreaterThanOrEqual(5);
    expect(open[0]).toMatchObject({ user: { fullName: expect.any(String) }, resolvedAt: null });
    expect((await http.get('/api/v1/dashboard').set(as(boss)).expect(200)).body.team.openAlerts).toBe(open.length);

    const target = open.find((a: { kind: string }) => a.kind === 'SHORT_REST');
    const done = (await http.post(`/api/v1/alerts/${target.id}/resolve`).set(as(boss)).expect(200)).body;
    expect(done).toMatchObject({ resolvedAt: expect.any(String), resolvedBy: { id: bossId } });
    expect((await http.get('/api/v1/alerts').set(as(boss)).expect(200)).body).toHaveLength(open.length - 1);
    expect((await http.get('/api/v1/alerts?status=all').set(as(boss)).expect(200)).body).toHaveLength(open.length);
  });

  it('las pasadas programadas recorren las empresas con actividad sin fallar', async () => {
    const warn = jest.spyOn((alerts as unknown as { log: { warn: (m: string) => void } }).log, 'warn');
    await alerts.scan(new Date());
    await alerts.daily(new Date());
    expect(warn).not.toHaveBeenCalled();
  }, 60_000);
});
