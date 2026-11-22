import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from './prisma/prisma.service';
import { AppModule } from './app.module';
import { setupApp } from './setup';

/** Test de integración contra la base de datos real (requiere migraciones aplicadas). */
describe('Cuentas, espacios e invitaciones', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const run = randomUUID().slice(0, 8);
  const boss = { email: `Jefa.${run}@test.dev`, password: 'secreto-1234', fullName: 'Marta Jefa' };
  const worker = { email: `obrero.${run}@test.dev`, password: 'secreto-1234', fullName: 'Luis Obrero' };

  const cookieOf = (res: request.Response): string => (res.get('Set-Cookie') ?? [])[0]!.split(';')[0]!;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(() => app.close());

  let bossToken: string;
  let bossCookie: string;
  let workerToken: string;
  let orgId: string;

  it('rechaza peticiones sin sesión y datos no válidos', async () => {
    await http.get('/api/v1/me').expect(401);
    const res = await http.post('/api/v1/auth/register').send({ email: 'x', password: '1', fullName: '' }).expect(400);
    expect(res.body.code).toBe('VALIDATION');
  });

  it('registra, y el correo es único sin distinguir mayúsculas', async () => {
    const res = await http.post('/api/v1/auth/register').send(boss).expect(201);
    bossToken = res.body.accessToken;
    bossCookie = cookieOf(res);
    expect(res.get('Set-Cookie')![0]).toMatch(/HttpOnly/);
    const dup = await http
      .post('/api/v1/auth/register')
      .send({ ...boss, email: boss.email.toUpperCase() })
      .expect(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
  });

  it('inicia sesión y no revela si el correo existe', async () => {
    await http.post('/api/v1/auth/login').send({ email: boss.email, password: boss.password }).expect(200);
    const bad = await http.post('/api/v1/auth/login').send({ email: boss.email, password: 'otra-cosa' }).expect(401);
    const none = await http.post('/api/v1/auth/login').send({ email: `nadie.${run}@test.dev`, password: 'x' }).expect(401);
    expect(bad.body.code).toBe('INVALID_CREDENTIALS');
    expect(none.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('una cuenta nueva solo tiene espacio personal', async () => {
    const res = await http.get('/api/v1/me').set(bearer(bossToken)).expect(200);
    expect(res.body.user.email).toBe(boss.email.toLowerCase());
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.workspaces).toEqual([{ kind: 'personal' }]);
  });

  it('rota el token de renovación', async () => {
    const res = await http.post('/api/v1/auth/refresh').set('Cookie', bossCookie).expect(200);
    expect(cookieOf(res)).not.toBe(bossCookie);
    // Una renovación simultánea con el token anterior (otra pestaña, una respuesta cortada) no cierra la sesión.
    const concurrent = await http.post('/api/v1/auth/refresh').set('Cookie', bossCookie).expect(200);
    expect(cookieOf(concurrent)).not.toBe(bossCookie);
    bossToken = res.body.accessToken;
    bossCookie = cookieOf(res);
    await http.post('/api/v1/auth/refresh').expect(401);
  });

  it('un token rotado hace tiempo se considera robado y cierra toda la cadena', async () => {
    const login = await http.post('/api/v1/auth/login').send({ email: boss.email, password: boss.password }).expect(200);
    const first = cookieOf(login);
    const second = cookieOf(await http.post('/api/v1/auth/refresh').set('Cookie', first).expect(200));
    const prisma = app.get(PrismaService);
    await prisma.refreshToken.updateMany({ where: { user: { email: boss.email.toLowerCase() }, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } });
    await http.post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    await http.post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
  });

  it('crear una empresa convierte al creador en administrador', async () => {
    const res = await http
      .post('/api/v1/organizations')
      .set(bearer(bossToken))
      .send({ name: `Reformas ${run}`, taxId: 'B12345678' })
      .expect(201);
    orgId = res.body.organizationId;
    const me = await http.get('/api/v1/me').set(bearer(bossToken)).expect(200);
    expect(me.body.workspaces).toContainEqual({
      geoNoticeAccepted: false,
      branding: { name: null, accent: null, logo: false },
      kind: 'organization',
      organizationId: orgId,
      name: `Reformas ${run}`,
      role: 'ADMIN',
    });
  });

  it('el equipo no es accesible desde el espacio personal ni desde fuera de la empresa', async () => {
    const personal = await http.get('/api/v1/members').set(bearer(bossToken)).expect(403);
    expect(personal.body.code).toBe('FORBIDDEN_ROLE');
    const reg = await http.post('/api/v1/auth/register').send(worker).expect(201);
    workerToken = reg.body.accessToken;
    const outsider = await http.get('/api/v1/members').set(bearer(workerToken)).set('X-Workspace', orgId).expect(403);
    expect(outsider.body.code).toBe('FORBIDDEN_WORKSPACE');
  });

  it('invita, y la invitación solo vale para el correo invitado', async () => {
    const inv = await http
      .post('/api/v1/invitations')
      .set(bearer(bossToken))
      .set('X-Workspace', orgId)
      .send({ email: worker.email })
      .expect(201);
    const token: string = inv.body.token;
    expect(token).toBeTruthy();

    const preview = await http.get(`/api/v1/invite/${token}`).expect(200);
    expect(preview.body).toMatchObject({ organizationName: `Reformas ${run}`, role: 'EMPLOYEE', status: 'valid' });

    const wrong = await http.post(`/api/v1/invite/${token}/accept`).set(bearer(bossToken)).expect(403);
    expect(wrong.body.code).toBe('INVITATION_EMAIL_MISMATCH');

    await http.post(`/api/v1/invite/${token}/accept`).set(bearer(workerToken)).expect(200);
    await http.post(`/api/v1/invite/${token}/accept`).set(bearer(workerToken)).expect(410);
    await http.get('/api/v1/invite/no-existe').expect(404);
  });

  it('un empleado no gestiona el equipo; el administrador sí', async () => {
    await http.get('/api/v1/members').set(bearer(workerToken)).set('X-Workspace', orgId).expect(403);
    await http
      .post('/api/v1/invitations')
      .set(bearer(workerToken))
      .set('X-Workspace', orgId)
      .send({ email: `otro.${run}@test.dev` })
      .expect(403);

    const list = await http.get('/api/v1/members').set(bearer(bossToken)).set('X-Workspace', orgId).expect(200);
    expect(list.body).toHaveLength(2);
    const again = await http
      .post('/api/v1/invitations')
      .set(bearer(bossToken))
      .set('X-Workspace', orgId)
      .send({ email: worker.email })
      .expect(409);
    expect(again.body.code).toBe('ALREADY_MEMBER');
  });

  it('no deja a la empresa sin administrador y desactivar corta el acceso al instante', async () => {
    const list = await http.get('/api/v1/members').set(bearer(bossToken)).set('X-Workspace', orgId);
    const admin = list.body.find((m: { role: string }) => m.role === 'ADMIN');
    const emp = list.body.find((m: { role: string }) => m.role === 'EMPLOYEE');

    const last = await http
      .patch(`/api/v1/members/${admin.id}`)
      .set(bearer(bossToken))
      .set('X-Workspace', orgId)
      .send({ role: 'EMPLOYEE' })
      .expect(409);
    expect(last.body.code).toBe('LAST_ADMIN');

    await http
      .patch(`/api/v1/members/${emp.id}`)
      .set(bearer(bossToken))
      .set('X-Workspace', orgId)
      .send({ active: false })
      .expect(204);
    const me = await http.get('/api/v1/me').set(bearer(workerToken)).expect(200);
    expect(me.body.workspaces).toEqual([{ kind: 'personal' }]);
  });

  it('cerrar sesión invalida el token de renovación, y reutilizarlo no funciona', async () => {
    await http.post('/api/v1/auth/logout').set('Cookie', bossCookie).expect(204);
    await http.post('/api/v1/auth/refresh').set('Cookie', bossCookie).expect(401);
  });
});
