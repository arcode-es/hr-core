import type { INestApplication } from '@nestjs/common';
import { DEFAULT_EMAIL_PREFS } from '@hr/shared';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { textPdf } from '../demo/assets';
import { LogMailer, Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp } from '../testing/boot';
import { DigestService } from './digest.service';

describe('Avisos por correo y resumen diario', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  const run = randomUUID().slice(0, 8);
  const mail = (n: string) => `${n}.${run}@email.dev`;
  let boss: string;
  let worker: string;
  let workerId: string;
  let orgId: string;
  const as = (token: string) => ({ ...bearer(token), 'X-Workspace': orgId });
  const to = (address: string, tag?: string) => mailer.outbox.filter((m) => m.to === address && (!tag || m.tag === tag));
  /** Los correos de los avisos salen en segundo plano. */
  const settle = () => new Promise((r) => setTimeout(r, 250));

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    prisma = app.get(PrismaService);
    mailer = app.get(Mailer) as LogMailer;
    boss = (await http.post('/api/v1/auth/register').send({ email: mail('jefa'), password: 'secreto-1234', fullName: 'Jefa Correo' }).expect(201)).body.accessToken;
    orgId = (await http.post('/api/v1/organizations').set(bearer(boss)).send({ name: `Correo ${run}` }).expect(201)).body.organizationId;
    worker = (await http.post('/api/v1/auth/register').send({ email: mail('obrero'), password: 'secreto-1234', fullName: 'Obrero Correo' }).expect(201)).body.accessToken;
    const inv = await http.post('/api/v1/invitations').set(as(boss)).send({ email: mail('obrero') }).expect(201);
    await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(worker)).expect(200);
    workerId = (await http.get('/api/v1/me').set(bearer(worker))).body.user.id;
  });
  afterAll(() => app.close());

  const sendDoc = async (title: string) =>
    http
      .post('/api/v1/documents')
      .set(as(boss))
      .field('data', JSON.stringify({ title, category: 'ANNOUNCEMENT', requiresSignature: false, recipients: [workerId] }))
      .attach('file', await textPdf(title, '', ['Texto.']), 'doc.pdf')
      .expect(201);

  it('cada persona elige qué avisos le llegan por correo', async () => {
    expect((await http.get('/api/v1/me/email-prefs').set(bearer(worker)).expect(200)).body).toEqual(DEFAULT_EMAIL_PREFS);
    await sendDoc('Calendario de verano');
    await settle();
    const [notice] = to(mail('obrero'), 'notice');
    expect(notice!.subject).toContain('Calendario de verano');
    expect(notice!.text).toMatch(/\/documents\/[0-9a-f-]{36}/);
    expect(notice!.text).toContain('/settings');

    await http.put('/api/v1/me/email-prefs').set(bearer(worker)).send({ ...DEFAULT_EMAIL_PREFS, documents: false }).expect(200);
    await sendDoc('Normas nuevas');
    await settle();
    expect(to(mail('obrero'), 'notice')).toHaveLength(1);
    await http.put('/api/v1/me/email-prefs').set(bearer(worker)).send({ documents: 'sí' }).expect(400);
  });

  it('las validaciones pendientes no llegan una a una por correo (salvo que se active): van en el resumen diario', async () => {
    await http
      .post('/api/v1/expenses')
      .set(as(worker))
      .field('data', JSON.stringify({ category: 'FUEL', amount: 35, date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), paymentMethod: 'EMPLOYEE_PAID' }))
      .expect(201);
    await settle();
    expect(to(mail('jefa'), 'notice')).toEqual([]);

    const digest = app.get(DigestService);
    await digest.run(new Date(), [orgId]);
    const [summary] = to(mail('jefa'), 'digest');
    expect(summary!.subject).toBe(`Pendiente hoy en Correo ${run}`);
    expect(summary!.text).toContain('1 gasto por aprobar');
    // A quien no supervisa no le llega resumen; y quien lo desactiva deja de recibirlo.
    expect(to(mail('obrero'), 'digest')).toEqual([]);
    await http.put('/api/v1/me/email-prefs').set(bearer(boss)).send({ ...DEFAULT_EMAIL_PREFS, digest: false }).expect(200);
    await digest.run(new Date(), [orgId]);
    expect(to(mail('jefa'), 'digest')).toHaveLength(1);
  });

  it('en el horario de desconexión no sale el correo: llega junto con el push al terminar', async () => {
    const org = (await http.get('/api/v1/organization').set(as(boss))).body;
    const { id: _i, currency: _c, ...dto } = org;
    await http.patch('/api/v1/organization').set(as(boss)).send({ ...dto, quietHours: { enabled: true, start: '00:00', end: '23:59', weekends: true } }).expect(200);
    await http.put('/api/v1/me/email-prefs').set(bearer(worker)).send(DEFAULT_EMAIL_PREFS).expect(200);
    const before = to(mail('obrero'), 'notice').length;
    await sendDoc('Aviso nocturno 1');
    await sendDoc('Aviso nocturno 2');
    await settle();
    expect(to(mail('obrero'), 'notice')).toHaveLength(before);

    await http.patch('/api/v1/organization').set(as(boss)).send({ ...dto, quietHours: { enabled: false, start: '20:00', end: '08:00', weekends: true } }).expect(200);
    await app.get(require('./notifications.service').NotificationsService).releaseHeld(new Date());
    await settle();
    const after = to(mail('obrero'), 'notice');
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)!.subject).toContain('Tienes 2 avisos nuevos');
    expect(await prisma.notification.count({ where: { userId: workerId, pushedAt: null } })).toBe(0);
  });
});
