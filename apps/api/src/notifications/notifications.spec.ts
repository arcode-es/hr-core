import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import webpush from 'web-push';
import { AppModule } from '../app.module';
import { GeoService } from '../geo/geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { setupApp } from '../setup';
import { pushText } from './messages';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('Avisos, panel, ajustes de empresa y contraseña', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const sent: { endpoint: string; body: { body: string; link: string } }[] = [];

  let boss: string;
  let worker: string;
  let mate: string;
  let orgId: string;
  let workerId: string;

  const as = (token: string, ws?: string) => ({ Authorization: `Bearer ${token}`, ...(ws ? { 'X-Workspace': ws } : {}) });
  const signUp = async (name: string, locale = 'es'): Promise<string> =>
    (await http.post('/api/v1/auth/register').send({ email: `${name}.${run}@notif.dev`, password: 'secreto-1234', fullName: name, locale }).expect(201)).body.accessToken;
  const inbox = async (token: string) => (await http.get('/api/v1/notifications').set(as(token)).expect(200)).body as { unread: number; items: { id: string; type: string; payload: Record<string, unknown>; read: boolean; organizationName: string | null }[] };
  const types = async (token: string): Promise<string[]> => (await inbox(token)).items.map((n) => n.type);
  const day = (offset: number, hhmm: string): string => `${new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)}T${hhmm}:00.000Z`;

  beforeAll(async () => {
    jest.spyOn(webpush, 'sendNotification').mockImplementation(async (sub, payload) => {
      if (sub.endpoint.includes('caducada')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, body: JSON.parse(String(payload)) });
      return { statusCode: 201, body: '', headers: {} };
    });
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
    worker = await signUp('obrero', 'en');
    mate = await signUp('colega');
    orgId = (await http.post('/api/v1/organizations').set(as(boss)).send({ name: `Avisos ${run}` }).expect(201)).body.organizationId;
    for (const [token, name] of [[worker, 'obrero'], [mate, 'colega']] as const) {
      const inv = await http.post('/api/v1/invitations').set(as(boss, orgId)).send({ email: `${name}.${run}@notif.dev` }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(as(token)).expect(200);
    }
    workerId = (await http.get('/api/v1/me').set(as(worker))).body.user.id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('expone la clave pública y guarda la suscripción push del dispositivo', async () => {
    const key = await http.get('/api/v1/push/key').set(as(worker)).expect(200);
    expect(key.body.publicKey).toBeTruthy();
    const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'BPk-clave', auth: 'secreto' } });
    await http.post('/api/v1/push/subscribe').set(as(worker)).send(sub(`https://push.example/${run}/movil`)).expect(204);
    await http.post('/api/v1/push/subscribe').set(as(worker)).send(sub(`https://push.example/${run}/caducada`)).expect(204);
    await http.post('/api/v1/push/subscribe').set(as(worker)).send({ endpoint: 'no-es-url', keys: {} }).expect(400);
  });

  it('publicar el cuadrante avisa a cada persona de sus turnos, en su idioma y por push', async () => {
    const shift = (d: number) => ({ userId: workerId, start: new Date(Date.now() + d * 86_400_000).toISOString(), end: new Date(Date.now() + d * 86_400_000 + 8 * 3600_000).toISOString(), breakMinutes: 0 });
    await http.post('/api/v1/shifts').set(as(boss, orgId)).send({ shifts: [shift(1), shift(2), shift(3)] }).expect(201);
    expect(await types(worker)).toEqual([]); // los borradores no avisan
    await http.post('/api/v1/shifts/publish').set(as(boss, orgId)).send({ from: new Date().toISOString(), to: new Date(Date.now() + 10 * 86_400_000).toISOString() }).expect(200);

    const list = await inbox(worker);
    expect(list.unread).toBe(1);
    expect(list.items[0]).toMatchObject({ type: 'SHIFT_PUBLISHED', payload: { count: 3, link: '/schedule' }, read: false, organizationName: `Avisos ${run}` });
    // El envío push y la limpieza de la suscripción caducada van en segundo plano: se espera a que terminen
    // (con un tope) en vez de dar un tiempo fijo, que en una máquina lenta se queda corto.
    const caducadas = () => prisma.pushSubscription.count({ where: { endpoint: { contains: `${run}/caducada` } } });
    for (let i = 0; i < 50 && (!sent.some((m) => m.endpoint.endsWith(`${run}/movil`)) || (await caducadas()) > 0); i++) await new Promise((r) => setTimeout(r, 100));
    expect(sent.at(-1)).toMatchObject({ endpoint: `https://push.example/${run}/movil`, body: { body: 'You have 3 new published shifts.', link: '/schedule' } });
    // La suscripción que el navegador dio de baja se ha limpiado sola.
    expect(await caducadas()).toBe(0);
    expect(await types(mate)).toEqual([]);
  });

  it('cambiar o quitar un turno ya publicado avisa; marcar como leído baja el contador', async () => {
    const list = await http.get('/api/v1/shifts').query({ from: new Date().toISOString(), to: new Date(Date.now() + 10 * 86_400_000).toISOString() }).set(as(boss, orgId)).expect(200);
    await http.delete(`/api/v1/shifts/${list.body[0].id}`).set(as(boss, orgId)).expect(204);
    const before = await inbox(worker);
    expect(before.items.map((n) => n.type)).toEqual(['SHIFT_UPDATED', 'SHIFT_PUBLISHED']);
    await http.post('/api/v1/notifications/read').set(as(worker)).send({ ids: [before.items[1]!.id] }).expect(204);
    expect((await inbox(worker)).unread).toBe(1);
    await http.post('/api/v1/notifications/read').set(as(worker)).send({}).expect(204);
    expect((await inbox(worker)).unread).toBe(0);
    // Nadie marca como leídos los avisos de otro.
    await http.post('/api/v1/notifications/read').set(as(mate)).send({ ids: [before.items[0]!.id] }).expect(204);
  });

  it('jornada manual: avisa a quien valida y, al resolver, a quien la envió', async () => {
    const res = await http.post('/api/v1/time/manual').set(as(worker, orgId)).send({ start: day(2, '08:00'), end: day(2, '16:00'), breaks: [], reason: 'Olvidé fichar' }).expect(201);
    expect((await inbox(boss)).items[0]).toMatchObject({ type: 'TIME_ENTRY_PENDING', payload: { name: 'obrero', link: '/timesheets' } });
    expect(await types(mate)).toEqual([]);
    await http.post(`/api/v1/time/review/${res.body.id}`).set(as(boss, orgId)).send({ decision: 'REJECT', reason: 'No consta' }).expect(204);
    expect((await inbox(worker)).items[0]).toMatchObject({ type: 'TIME_ENTRY_REVIEWED', payload: { approved: false } });
  });

  it('gasto: avisa al enviarlo y al aprobarlo, con el importe', async () => {
    const res = await http.post('/api/v1/expenses').set(as(worker, orgId)).field('data', JSON.stringify({ category: 'MEAL', amount: 23.9, date: day(1, '00:00').slice(0, 10), paymentMethod: 'EMPLOYEE_PAID' })).expect(201);
    expect((await inbox(boss)).items[0]).toMatchObject({ type: 'EXPENSE_PENDING', payload: { name: 'obrero', amount: '23,90 €' } });
    await http.post(`/api/v1/expenses/${res.body.id}/review`).set(as(boss, orgId)).send({ decision: 'APPROVE' }).expect(200);
    expect((await inbox(worker)).items[0]).toMatchObject({ type: 'EXPENSE_REVIEWED', payload: { approved: true, amount: '23,90 €' } });
    expect(pushText('es', 'EXPENSE_REVIEWED', { link: '/', approved: true, amount: '23,90 €' })).toBe('Tu gasto de 23,90 € ha sido aprobado.');
  });

  it('documento: avisa al destinatario con enlace al suyo y, al firmar, al emisor', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const res = await http
      .post('/api/v1/documents')
      .set(as(boss, orgId))
      .field('data', JSON.stringify({ title: 'Contrato', category: 'CONTRACT', requiresSignature: true, recipients: [workerId] }))
      .attach('file', Buffer.from(await pdf.save()), { filename: 'c.pdf', contentType: 'application/pdf' })
      .expect(201);
    const id = res.body[0].id;
    expect((await inbox(worker)).items[0]).toMatchObject({ type: 'DOCUMENT_RECEIVED', payload: { title: 'Contrato', requiresSignature: true, link: `/documents/${id}` } });
    await http.patch('/api/v1/me').set(as(worker)).send({ dniNie: '12345678Z' }).expect(200);
    await http.post(`/api/v1/documents/${id}/sign`).set(as(worker, orgId)).send({ signature: `data:image/png;base64,${PNG.toString('base64')}`, strokes: 2, points: 40 }).expect(200);
    expect((await inbox(boss)).items[0]).toMatchObject({ type: 'DOCUMENT_SIGNED', payload: { name: 'obrero', title: 'Contrato' } });
  });

  it('panel: lo mío para todos y el resumen del equipo solo para quien supervisa', async () => {
    const mine = await http.get('/api/v1/dashboard').set(as(worker, orgId)).expect(200);
    expect(mine.body.team).toBeNull();
    expect(mine.body.me.documentsPending).toBe(0);
    expect(mine.body.me.nextShift).toMatchObject({ user: { fullName: 'obrero' }, published: true });

    await http.post('/api/v1/time/clock').set(as(mate, orgId)).field('data', JSON.stringify({ action: 'START', position: null, clientTime: new Date().toISOString(), clientUuid: randomUUID() })).expect(200);
    await http.post('/api/v1/time/manual').set(as(mate, orgId)).send({ start: day(3, '08:00'), end: day(3, '12:00'), breaks: [], reason: 'Pendiente' }).expect(201);
    await http.post('/api/v1/expenses').set(as(mate, orgId)).field('data', JSON.stringify({ category: 'FUEL', amount: 40, date: day(1, '00:00').slice(0, 10), paymentMethod: 'EMPLOYEE_PAID' })).expect(201);
    const team = await http.get('/api/v1/dashboard').set(as(boss, orgId)).expect(200);
    expect(team.body.team).toEqual({ members: 3, clockedIn: 1, onBreak: 0, pendingTimeEntries: 1, pendingExpenses: 1, documentsAwaiting: 0, pendingAbsences: 0, absentToday: 0, openAlerts: 0 });
    expect((await http.get('/api/v1/dashboard').set(as(worker)).expect(200)).body).toEqual({ me: { documentsPending: 0, nextShift: null }, team: null });
  });

  it('ajustes de empresa: los cambia el administrador y afectan al cálculo', async () => {
    const settings = { name: `Avisos ${run} S.L.`, taxId: 'B87654321', timezone: 'Europe/Madrid', nightStart: '21:00', nightEnd: '07:00', mileageRatePerKm: 0.3, allowEmployeeManualEntries: false, defaultGeofenceRadiusMeters: 150 };
    await http.patch('/api/v1/organization').set(as(worker, orgId)).send(settings).expect(403);
    await http.patch('/api/v1/organization').set(as(boss, orgId)).send({ ...settings, timezone: 'Marte/Olympus' }).expect(400);
    await http.patch('/api/v1/organization').set(as(boss, orgId)).send({ ...settings, nightStart: '25:00' }).expect(400);
    const res = await http.patch('/api/v1/organization').set(as(boss, orgId)).send(settings).expect(200);
    expect(res.body).toMatchObject({ ...settings, currency: 'EUR' });
    expect((await http.get('/api/v1/me').set(as(boss))).body.workspaces[1].name).toBe(`Avisos ${run} S.L.`);
    // La tarifa nueva se aplica al kilometraje y el empleado ya no puede declarar horas.
    const km = await http.post('/api/v1/expenses').set(as(worker, orgId)).field('data', JSON.stringify({ category: 'MILEAGE', distanceKm: 100, date: day(1, '00:00').slice(0, 10) })).expect(201);
    expect(km.body.amount).toBe(30);
    const manual = await http.post('/api/v1/time/manual').set(as(worker, orgId)).send({ start: day(4, '08:00'), end: day(4, '12:00'), breaks: [], reason: 'No permitido' }).expect(403);
    expect(manual.body.code).toBe('MANUAL_NOT_ALLOWED');
  });

  it('cambiar la contraseña exige la actual, cierra las demás sesiones y conserva esta', async () => {
    const email = `clave.${run}@notif.dev`;
    const reg = await http.post('/api/v1/auth/register').send({ email, password: 'secreto-1234', fullName: 'Clave' }).expect(201);
    const cookie = (res: request.Response): string => (res.get('Set-Cookie') ?? [])[0]!.split(';')[0]!;
    const here = cookie(reg);
    const other = cookie(await http.post('/api/v1/auth/login').send({ email, password: 'secreto-1234' }).expect(200));
    const token = reg.body.accessToken;

    await http.post('/api/v1/auth/password').send({ currentPassword: 'secreto-1234', newPassword: 'nueva-clave-99' }).expect(401);
    const wrong = await http.post('/api/v1/auth/password').set(as(token)).set('Cookie', here).send({ currentPassword: 'no-es', newPassword: 'nueva-clave-99' }).expect(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    await http.post('/api/v1/auth/password').set(as(token)).set('Cookie', here).send({ currentPassword: 'secreto-1234', newPassword: 'corta' }).expect(400);
    await http.post('/api/v1/auth/password').set(as(token)).set('Cookie', here).send({ currentPassword: 'secreto-1234', newPassword: 'nueva-clave-99' }).expect(204);

    await http.post('/api/v1/auth/refresh').set('Cookie', other).expect(401);
    await http.post('/api/v1/auth/refresh').set('Cookie', here).expect(200);
    await http.post('/api/v1/auth/login').send({ email, password: 'secreto-1234' }).expect(401);
    await http.post('/api/v1/auth/login').send({ email, password: 'nueva-clave-99' }).expect(200);
  });
});
