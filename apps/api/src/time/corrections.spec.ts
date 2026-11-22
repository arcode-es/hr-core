import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { GeoService } from '../geo/geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { setupApp } from '../setup';

describe('Fichaje manual, correcciones y validación', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);

  let boss: string;
  let worker: string;
  let mate: string;
  let orgId: string;
  let workerId: string;

  const as = (token: string, ws?: string) => ({ Authorization: `Bearer ${token}`, ...(ws ? { 'X-Workspace': ws } : {}) });
  const signUp = async (name: string): Promise<string> =>
    (await http.post('/api/v1/auth/register').send({ email: `${name}.${run}@corr.dev`, password: 'secreto-1234', fullName: name }).expect(201))
      .body.accessToken;
  // Días pasados, para no chocar con «no se puede declarar el futuro».
  const day = (offset: number, hhmm: string): string => {
    const d = new Date(Date.now() - offset * 86_400_000);
    return `${d.toISOString().slice(0, 10)}T${hhmm}:00.000Z`;
  };
  const body = (offset: number, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    start: day(offset, start),
    end: day(offset, end),
    breaks: [],
    reason: 'Olvidé fichar ese día',
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
    mate = await signUp('colega');
    orgId = (await http.post('/api/v1/organizations').set(as(boss)).send({ name: `Correcciones ${run}` }).expect(201)).body.organizationId;
    for (const [token, name] of [[worker, 'obrero'], [mate, 'colega']] as const) {
      const inv = await http.post('/api/v1/invitations').set(as(boss, orgId)).send({ email: `${name}.${run}@corr.dev` }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(as(token)).expect(200);
    }
    workerId = (await http.get('/api/v1/me').set(as(worker))).body.user.id;
  });

  afterAll(() => app.close());

  it('valida el rango, el motivo y no admite jornadas futuras', async () => {
    const post = (b: object) => http.post('/api/v1/time/manual').set(as(worker, orgId)).send(b);
    expect((await post(body(3, '16:00', '08:00')).expect(400)).body.code).toBe('INVALID_RANGE');
    expect((await post(body(-2, '08:00', '16:00')).expect(400)).body.code).toBe('INVALID_RANGE');
    await post(body(3, '08:00', '16:00', { reason: 'x' })).expect(400);
  });

  it('en el espacio personal la jornada manual queda aprobada y marcada como manual', async () => {
    const res = await http
      .post('/api/v1/time/manual')
      .set(as(worker))
      .send(body(3, '08:00', '17:00', { breaks: [{ kind: 'MEAL', start: day(3, '13:00'), end: day(3, '14:00') }] }))
      .expect(201);
    expect(res.body).toMatchObject({ manual: true, approvalStatus: 'APPROVED', workedSeconds: 8 * 3600, breakSeconds: 3600 });
    expect(res.body.segments.map((s: { entryType: string; origin: string }) => `${s.entryType}/${s.origin}`)).toEqual([
      'WORK/MANUAL',
      'BREAK/MANUAL',
      'WORK/MANUAL',
    ]);
  });

  let pendingId: string;

  it('la de un empleado en la empresa queda pendiente y no se puede solapar', async () => {
    const res = await http.post('/api/v1/time/manual').set(as(worker, orgId)).send(body(3, '08:00', '16:00')).expect(201);
    expect(res.body.approvalStatus).toBe('PENDING');
    pendingId = res.body.id;
    const overlap = await http.post('/api/v1/time/manual').set(as(worker, orgId)).send(body(3, '15:00', '18:00')).expect(409);
    expect(overlap.body.code).toBe('OVERLAP');
    // Justo a continuación sí cabe.
    await http.post('/api/v1/time/manual').set(as(worker, orgId)).send(body(3, '16:00', '18:00')).expect(201);
  });

  it('solo quien supervisa ve la bandeja; un empleado no', async () => {
    await http.get('/api/v1/time/review').set(as(worker, orgId)).expect(403);
    const res = await http.get('/api/v1/time/review').set(as(boss, orgId)).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ user: { fullName: 'obrero' }, reason: 'Olvidé fichar ese día', original: null });
  });

  it('rechazar exige motivo; aprobar deja rastro de quién y cuándo', async () => {
    await http.post(`/api/v1/time/review/${pendingId}`).set(as(boss, orgId)).send({ decision: 'REJECT' }).expect(400);
    await http.post(`/api/v1/time/review/${pendingId}`).set(as(boss, orgId)).send({ decision: 'APPROVE' }).expect(204);
    await http.post(`/api/v1/time/review/${pendingId}`).set(as(boss, orgId)).send({ decision: 'APPROVE' }).expect(404);

    const trail = await http.get(`/api/v1/time/workdays/${pendingId}/audit`).set(as(worker, orgId)).expect(200);
    expect(trail.body.map((a: { action: string }) => a.action)).toEqual(['APPROVE', 'CREATE_MANUAL']);
    expect(trail.body[0]).toMatchObject({ changedBy: { fullName: 'jefa' }, newValues: { approvalStatus: 'APPROVED' }, oldValues: { approvalStatus: 'PENDING' } });
  });

  it('rechazada: conserva el motivo y libera el hueco', async () => {
    const list = await http.get('/api/v1/time/review').set(as(boss, orgId)).expect(200);
    const id = list.body[0].proposal.id;
    await http.post(`/api/v1/time/review/${id}`).set(as(boss, orgId)).send({ decision: 'REJECT', reason: 'Ese día no hubo horas extra' }).expect(204);
    const days = await http.get('/api/v1/time/workdays?days=10').set(as(worker, orgId)).expect(200);
    const rejected = days.body.find((d: { id: string }) => d.id === id);
    expect(rejected).toMatchObject({ approvalStatus: 'REJECTED', rejectionReason: 'Ese día no hubo horas extra' });
    await http.post('/api/v1/time/manual').set(as(worker, orgId)).send(body(3, '16:00', '17:00')).expect(201);
  });

  it('la corrección de un empleado no toca la jornada original hasta que se aprueba', async () => {
    const proposal = await http
      .post(`/api/v1/time/workdays/${pendingId}/correct`)
      .set(as(worker, orgId))
      .send(body(3, '07:30', '16:00', { reason: 'Entré media hora antes' }))
      .expect(201);
    expect(proposal.body).toMatchObject({ approvalStatus: 'PENDING', replacesWorkdayId: pendingId });

    const again = await http.post(`/api/v1/time/workdays/${pendingId}/correct`).set(as(worker, orgId)).send(body(3, '07:00', '16:00')).expect(409);
    expect(again.body.code).toBe('CORRECTION_PENDING');

    const review = await http.get('/api/v1/time/review').set(as(boss, orgId)).expect(200);
    const item = review.body.find((r: { proposal: { id: string } }) => r.proposal.id === proposal.body.id);
    expect(item.original.id).toBe(pendingId);
    expect(item.original.workedSeconds).toBe(8 * 3600);
    expect(item.proposal.workedSeconds).toBe(8.5 * 3600);

    await http.post(`/api/v1/time/review/${proposal.body.id}`).set(as(boss, orgId)).send({ decision: 'APPROVE' }).expect(204);
    const days = await http.get('/api/v1/time/workdays?days=10').set(as(worker, orgId)).expect(200);
    const current = days.body.filter((d: { id: string }) => d.id === pendingId);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ approvalStatus: 'APPROVED', workedSeconds: 8.5 * 3600, replacesWorkdayId: null });
  });

  it('nada se pierde: los tramos originales siguen en la base de datos, anulados, y el historial lo cuenta todo', async () => {
    const rows = await prisma.timeEntry.findMany({ where: { workdayId: pendingId }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.voidedAt).not.toBeNull();
    expect(rows[0]!.startTime.toISOString()).toBe(day(3, '08:00'));
    expect(rows[1]!.voidedAt).toBeNull();

    const trail = await http.get(`/api/v1/time/workdays/${pendingId}/audit`).set(as(boss, orgId)).expect(200);
    expect(trail.body.map((a: { action: string }) => a.action).sort()).toEqual(['APPROVE', 'APPROVE', 'CREATE_CORRECTION', 'CREATE_MANUAL', 'VOID']);
    const voided = trail.body.find((a: { action: string }) => a.action === 'VOID');
    expect(voided).toMatchObject({ oldValues: { voided: false, startTime: day(3, '08:00') }, newValues: { voided: true } });
    // El historial es inmutable también desde la aplicación.
    await expect(prisma.timeEntryAudit.updateMany({ where: { timeEntry: { workdayId: pendingId } }, data: { reason: 'manipulado' } })).rejects.toThrow();
  });

  it('el responsable corrige directamente y puede registrar la jornada de otra persona', async () => {
    const fixed = await http
      .post(`/api/v1/time/workdays/${pendingId}/correct`)
      .set(as(boss, orgId))
      .send(body(3, '07:30', '15:30', { reason: 'Salió antes según el parte de obra' }))
      .expect(201);
    expect(fixed.body).toMatchObject({ id: pendingId, approvalStatus: 'APPROVED', workedSeconds: 8 * 3600 });

    const forWorker = await http
      .post('/api/v1/time/manual')
      .set(as(boss, orgId))
      .send(body(5, '09:00', '14:00', { userId: workerId, reason: 'Parte firmado en papel' }))
      .expect(201);
    expect(forWorker.body.approvalStatus).toBe('APPROVED');
    const days = await http.get('/api/v1/time/workdays?days=10').set(as(worker, orgId)).expect(200);
    expect(days.body.some((d: { id: string }) => d.id === forWorker.body.id)).toBe(true);
  });

  it('un empleado no puede registrar ni corregir por un compañero, ni ver su historial', async () => {
    await http.post('/api/v1/time/manual').set(as(mate, orgId)).send(body(6, '09:00', '14:00', { userId: workerId })).expect(403);
    await http.post(`/api/v1/time/workdays/${pendingId}/correct`).set(as(mate, orgId)).send(body(3, '07:30', '15:00')).expect(404);
    const trail = await http.get(`/api/v1/time/workdays/${pendingId}/audit`).set(as(mate, orgId)).expect(200);
    expect(trail.body).toEqual([]);
  });

  it('una jornada en curso no se corrige: primero hay que finalizarla', async () => {
    const data = JSON.stringify({ action: 'START', position: null, clientTime: new Date().toISOString(), clientUuid: randomUUID() });
    const open = await http.post('/api/v1/time/clock').set(as(mate, orgId)).field('data', data).expect(200);
    const res = await http.post(`/api/v1/time/workdays/${open.body.workday.id}/correct`).set(as(mate, orgId)).send(body(0, '00:00', '00:01')).expect(409);
    expect(res.body.code).toBe('WORKDAY_OPEN');
  });

  it('la vista de equipo lista a todos, con su estado actual y sus jornadas del intervalo', async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    await http.get('/api/v1/time/team').query({ from, to }).set(as(worker, orgId)).expect(403);
    const res = await http.get('/api/v1/time/team').query({ from, to }).set(as(boss, orgId)).expect(200);
    const byName = Object.fromEntries(res.body.map((r: { user: { fullName: string } }) => [r.user.fullName, r]));
    expect(Object.keys(byName).sort()).toEqual(['colega', 'jefa', 'obrero']);
    expect(byName.colega).toMatchObject({ state: 'WORKING' });
    expect(byName.colega.workdays).toHaveLength(1);
    expect(byName.obrero).toMatchObject({ state: 'IDLE', workdays: [] });
  });

  it('si la empresa lo desactiva, el empleado no puede declarar horas', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { settings: { allowEmployeeManualEntries: false } } });
    const res = await http.post('/api/v1/time/manual').set(as(worker, orgId)).send(body(7, '08:00', '16:00')).expect(403);
    expect(res.body.code).toBe('MANUAL_NOT_ALLOWED');
    await http.post('/api/v1/time/manual').set(as(boss, orgId)).send(body(7, '08:00', '16:00')).expect(201);
  });
});
