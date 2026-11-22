import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { JobsService } from '../jobs/jobs.service';
import { LogMailer } from '../mail/mailer';
import { Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp, cookieOf } from '../testing/boot';

/** Instalación abierta con verificación del correo, bloqueo por intentos, sesiones y programador. */
describe('Seguridad de la cuenta (modo abierto)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const user = { email: `seguro.${run}@test.dev`, password: 'secreto-1234', fullName: 'Sara Segura' };

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', EMAIL_VERIFICATION: 'required', LOGIN_MAX_ATTEMPTS: '3' }));
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  it('sin confirmar el correo no se crean empresas; con el enlace, sí', async () => {
    const reg = await http.post('/api/v1/auth/register').send(user).expect(201);
    const token = reg.body.accessToken as string;
    expect((await http.get('/api/v1/me').set(bearer(token))).body.user.emailVerified).toBe(false);
    const denied = await http.post('/api/v1/organizations').set(bearer(token)).send({ name: 'Mi empresa' }).expect(403);
    expect(denied.body.code).toBe('EMAIL_NOT_VERIFIED');

    // El correo sale en segundo plano tras el registro: se espera a que llegue.
    const outbox = (app.get(Mailer) as LogMailer).outbox;
    for (let i = 0; i < 50 && !outbox.some((m) => m.to === user.email); i++) await new Promise((r) => setTimeout(r, 100));
    const mail = outbox.filter((m) => m.to === user.email).at(-1)!;
    expect(mail.subject).toBe('Confirma tu correo de HR-Core');
    const link = /https?:\/\/\S+verify-email\?token=([A-Za-z0-9_-]+)/.exec(mail.text)!;
    await http.post('/api/v1/auth/verify-email').send({ token: link[1] }).expect(204);
    await http.post('/api/v1/auth/verify-email').send({ token: link[1] }).expect(400);
    await http.post('/api/v1/organizations').set(bearer(token)).send({ name: 'Mi empresa' }).expect(201);
  });

  it('bloquea la cuenta tras varios fallos seguidos, incluso con la clave buena', async () => {
    for (let i = 0; i < 2; i++) await http.post('/api/v1/auth/login').send({ email: user.email, password: 'mala' }).expect(401);
    const locked = await http.post('/api/v1/auth/login').send({ email: user.email, password: 'mala' }).expect(403);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect((await http.post('/api/v1/auth/login').send(user).expect(403)).body.code).toBe('ACCOUNT_LOCKED');
    // Pasado el bloqueo se entra y el contador vuelve a cero.
    await prisma.user.update({ where: { email: user.email }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await http.post('/api/v1/auth/login').send(user).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: user.email } })).failedLogins).toBe(0);
  });

  it('lista los dispositivos con sesión y cierra los demás', async () => {
    const a = await http.post('/api/v1/auth/login').set('User-Agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0').send(user).expect(200);
    const b = await http.post('/api/v1/auth/login').set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Firefox/131.0').send(user).expect(200);
    const list = await http.get('/api/v1/auth/sessions').set(bearer(a.body.accessToken)).set('Cookie', cookieOf(a)).expect(200);
    const mine = list.body.filter((s: { current: boolean }) => s.current);
    expect(mine).toHaveLength(1);
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    await http.delete('/api/v1/auth/sessions').set(bearer(a.body.accessToken)).set('Cookie', cookieOf(a)).expect(204);
    await http.post('/api/v1/auth/refresh').set('Cookie', cookieOf(b)).expect(401);
    await http.post('/api/v1/auth/refresh').set('Cookie', cookieOf(a)).expect(200);
  });

  it('el programador ejecuta cada tarea una sola vez por turno', async () => {
    const jobs = app.get(JobsService);
    const runs: Date[] = [];
    jobs.register({ name: `prueba-${run}`, schedule: { everyMinutes: 5 }, run: async (now) => void runs.push(now) });
    jobs.register({ name: `diaria-${run}`, schedule: { dailyAt: '03:00' }, run: async (now) => void runs.push(now) });
    const mine = [`prueba-${run}`, `diaria-${run}`];
    const tick = (at: Date) => jobs.tick(at, mine);
    const t0 = new Date('2030-01-15T00:00:00Z'); // 01:00 en Madrid: la diaria aún no toca
    await tick(t0);
    await tick(new Date(t0.getTime() + 60_000));
    expect(runs).toHaveLength(1);
    await tick(new Date(t0.getTime() + 5 * 60_000));
    expect(runs).toHaveLength(2);
    await tick(new Date('2030-01-15T02:30:00Z')); // 03:30 en Madrid: corre la diaria y otro turno de 5 min
    expect(runs).toHaveLength(4);
    await tick(new Date('2030-01-15T02:31:00Z'));
    expect(runs).toHaveLength(4);
    expect(jobs.slot({ dailyAt: '03:00' }, new Date('2030-01-15T01:59:00Z'))).toBeNull();
  });

  it('/meta dice que es una instalación abierta, sin cuentas demo', async () => {
    const res = await http.get('/api/v1/meta').expect(200);
    expect(res.body).toMatchObject({ mode: 'open', appName: 'HR-Core', demo: null });
  });
});
