import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { setupApp } from '../setup';
import { LogMailer, Mailer } from './mailer';
import { invitationEmail, passwordResetEmail } from './templates';

describe('Correo: recuperar contraseña, avisos de seguridad e invitaciones', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const mailer = new LogMailer();
  const run = randomUUID().slice(0, 8);
  const email = `olvido.${run}@mail.dev`;

  const settle = () => new Promise((r) => setTimeout(r, 150));
  const lastTo = (to: string) => [...mailer.outbox].reverse().find((m) => m.to === to);
  const tokenOf = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(Mailer).useValue(mailer).compile();
    app = mod.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    await http.post('/api/v1/auth/register').send({ email, password: 'secreto-1234', fullName: 'Olvido Pérez', locale: 'es' }).expect(201);
  });

  afterAll(() => app.close());

  it('pedir el enlace responde igual exista o no la cuenta, y solo escribe a quien existe', async () => {
    const before = mailer.outbox.length;
    await http.post('/api/v1/auth/forgot-password').send({ email: `nadie.${run}@mail.dev` }).expect(204);
    await http.post('/api/v1/auth/forgot-password').send({ email: email.toUpperCase() }).expect(204);
    await settle();
    expect(mailer.outbox.length).toBe(before + 1);
    const m = lastTo(email)!;
    expect(m.subject).toBe('Restablece tu contraseña de HR-Core');
    expect(m.tag).toBe('password_reset');
    expect(m.text).toContain('http://localhost:5173/reset-password?token=');
    expect(m.html).toContain('Elegir una contraseña nueva');
    await http.post('/api/v1/auth/forgot-password').send({ email: 'no-es-un-correo' }).expect(400);
  });

  it('no envía otro enlace a la misma cuenta antes de un minuto', async () => {
    const before = mailer.outbox.length;
    await http.post('/api/v1/auth/forgot-password').send({ email }).expect(204);
    await settle();
    expect(mailer.outbox.length).toBe(before);
  });

  it('el enlace cambia la contraseña una sola vez, cierra las sesiones y avisa por correo', async () => {
    const login = await http.post('/api/v1/auth/login').send({ email, password: 'secreto-1234' }).expect(200);
    const cookie = (login.get('Set-Cookie') ?? [])[0]!.split(';')[0]!;
    const token = tokenOf(lastTo(email)!.text);

    expect((await http.post('/api/v1/auth/reset-password/check').send({ token }).expect(200)).body).toEqual({ valid: true });
    await http.post('/api/v1/auth/reset-password').send({ token, newPassword: 'corta' }).expect(400);
    await http.post('/api/v1/auth/reset-password').send({ token, newPassword: 'nueva-clave-2026' }).expect(204);
    await settle();

    expect(lastTo(email)).toMatchObject({ subject: 'Se ha cambiado tu contraseña de HR-Core', tag: 'password_changed' });
    expect(lastTo(email)!.text).toContain('http://localhost:5173/forgot-password');
    await http.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    await http.post('/api/v1/auth/login').send({ email, password: 'secreto-1234' }).expect(401);
    await http.post('/api/v1/auth/login').send({ email, password: 'nueva-clave-2026' }).expect(200);

    const again = await http.post('/api/v1/auth/reset-password').send({ token, newPassword: 'otra-clave-2026' }).expect(400);
    expect(again.body.code).toBe('RESET_INVALID');
    expect((await http.post('/api/v1/auth/reset-password/check').send({ token }).expect(200)).body).toEqual({ valid: false });
  });

  it('un enlace caducado o sustituido por otro más reciente no vale', async () => {
    await prisma.passwordResetToken.updateMany({ where: { user: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await http.post('/api/v1/auth/forgot-password').send({ email }).expect(204);
    await settle();
    const first = tokenOf(lastTo(email)!.text);
    await prisma.passwordResetToken.updateMany({ where: { user: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await http.post('/api/v1/auth/forgot-password').send({ email }).expect(204);
    await settle();
    const second = tokenOf(lastTo(email)!.text);
    expect(second).not.toBe(first);
    expect((await http.post('/api/v1/auth/reset-password/check').send({ token: first })).body.valid).toBe(false);

    await prisma.passwordResetToken.updateMany({ where: { user: { email }, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http.post('/api/v1/auth/reset-password').send({ token: second, newPassword: 'otra-clave-2026' }).expect(400);
  });

  it('una cuenta desactivada no recibe enlaces', async () => {
    const off = `baja.${run}@mail.dev`;
    await http.post('/api/v1/auth/register').send({ email: off, password: 'secreto-1234', fullName: 'Baja' }).expect(201);
    await prisma.user.update({ where: { email: off }, data: { active: false } });
    await http.post('/api/v1/auth/forgot-password').send({ email: off }).expect(204);
    await settle();
    expect(lastTo(off)).toBeUndefined();
  });

  it('cambiar la contraseña desde ajustes también avisa por correo', async () => {
    const who = `cambio.${run}@mail.dev`;
    const reg = await http.post('/api/v1/auth/register').send({ email: who, password: 'secreto-1234', fullName: 'Cambio', locale: 'en' }).expect(201);
    await http
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .send({ currentPassword: 'secreto-1234', newPassword: 'nueva-clave-99' })
      .expect(204);
    await settle();
    expect(lastTo(who)!.subject).toBe('Your HR-Core password was changed');
  });

  it('invitar envía el enlace por correo en el idioma de quien invita', async () => {
    const boss = await http.post('/api/v1/auth/register').send({ email: `jefa.${run}@mail.dev`, password: 'secreto-1234', fullName: 'Marta <Ruiz>' }).expect(201);
    const h = { Authorization: `Bearer ${boss.body.accessToken}` };
    const org = await http.post('/api/v1/organizations').set(h).send({ name: 'Reformas & Hijos' }).expect(201);
    const invited = `nuevo.${run}@mail.dev`;
    const res = await http.post('/api/v1/invitations').set({ ...h, 'X-Workspace': org.body.organizationId }).send({ email: invited, role: 'MANAGER' }).expect(201);
    expect(res.body.emailed).toBe(true);
    const m = lastTo(invited)!;
    expect(m.subject).toBe('Marta <Ruiz> te invita a Reformas & Hijos en HR-Core');
    expect(m.text).toContain(`http://localhost:5173/invite/${res.body.token}`);
    expect(m.text).toContain('como responsable');
    // Los nombres que escribe el usuario se escapan en el HTML.
    expect(m.html).toContain('Marta &lt;Ruiz&gt;');
    expect(m.html).toContain('Reformas &amp; Hijos');
    expect(m.html).not.toContain('<Ruiz>');
  });

  it('si el proveedor falla, la invitación se crea igualmente y lo indica', async () => {
    const send = jest.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('Resend 500'));
    const boss = await http.post('/api/v1/auth/register').send({ email: `jefe2.${run}@mail.dev`, password: 'secreto-1234', fullName: 'Jefe' }).expect(201);
    const h = { Authorization: `Bearer ${boss.body.accessToken}` };
    const org = await http.post('/api/v1/organizations').set(h).send({ name: 'Otra' }).expect(201);
    const res = await http.post('/api/v1/invitations').set({ ...h, 'X-Workspace': org.body.organizationId }).send({ email: `x.${run}@mail.dev` }).expect(201);
    expect(res.body).toMatchObject({ emailed: false });
    expect(res.body.token).toBeTruthy();
    send.mockRestore();
  });
});

describe('plantillas', () => {
  it('tienen versión HTML y de texto, con el enlace en ambas', () => {
    const r = passwordResetEmail('en', { name: 'Ana López', url: 'https://rrhh.example.com/reset-password?token=abc', minutes: 60 });
    expect(r.subject).toBe('Reset your HR-Core password');
    expect(r.text).toContain('Hi Ana,');
    expect(r.text).toContain('https://rrhh.example.com/reset-password?token=abc');
    expect(r.html).toContain('href="https://rrhh.example.com/reset-password?token=abc"');
    expect(invitationEmail('es', { organization: 'A', inviter: 'B', role: 'empleado/a', url: 'https://x/invite/t', days: 7 }).html).toContain('lang="es"');
  });
});
