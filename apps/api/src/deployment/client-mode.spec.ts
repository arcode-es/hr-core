import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { InstallService } from '../install/install.service';
import { bearer, bootApp } from '../testing/boot';

/** El servidor de un cliente: una empresa creada por el script de instalación y alta solo con invitación. */
describe('Modo cliente', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const run = randomUUID().slice(0, 8);
  const adminEmail = `jefa.${run}@cliente.dev`;
  let adminToken: string;
  let orgId: string;

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'client' }));
  });
  afterAll(() => app.close());

  it('nadie se registra sin invitación', async () => {
    const res = await http.post('/api/v1/auth/register').send({ email: `libre.${run}@test.dev`, password: 'secreto-1234', fullName: 'Sin Invitación' }).expect(403);
    expect(res.body.code).toBe('INVITATION_REQUIRED');
  });

  it('el script de instalación crea la empresa y un enlace para que su administradora elija contraseña', async () => {
    const r = await app.get(InstallService).createOrganization({ name: `Cliente ${run} S.L.`, adminEmail, adminName: 'Marta Cliente' });
    orgId = r.organizationId;
    const token = new URL(r.setupUrl).searchParams.get('token')!;
    await http.post('/api/v1/auth/reset-password').send({ token, newPassword: 'clave-de-marta-1' }).expect(204);
    adminToken = (await http.post('/api/v1/auth/login').send({ email: adminEmail, password: 'clave-de-marta-1' }).expect(200)).body.accessToken;
    const me = await http.get('/api/v1/me').set(bearer(adminToken)).expect(200);
    expect(me.body.workspaces).toEqual([{ kind: 'organization', organizationId: orgId, name: `Cliente ${run} S.L.`, role: 'ADMIN', geoNoticeAccepted: false, branding: { name: null, accent: null, logo: false } }]);
  });

  it('la baja la gestiona la empresa, no la propia persona', async () => {
    const res = await http.post('/api/v1/me/delete').set(bearer(adminToken)).send({ password: 'clave-de-marta-1' }).expect(403);
    expect(res.body.code).toBe('ACCOUNT_DELETE_DISABLED');
  });

  it('desde la app no se crean empresas', async () => {
    const res = await http.post('/api/v1/organizations').set(bearer(adminToken)).send({ name: 'Otra' }).expect(403);
    expect(res.body.code).toBe('ORG_CREATION_DISABLED');
  });

  it('con la invitación sí: solo para el correo invitado, que queda verificado', async () => {
    const email = `obrero.${run}@cliente.dev`;
    const inv = await http.post('/api/v1/invitations').set(bearer(adminToken)).set('X-Workspace', orgId).send({ email, role: 'EMPLOYEE' }).expect(201);
    const other = await http.post('/api/v1/auth/register').send({ email: `otro.${run}@cliente.dev`, password: 'secreto-1234', fullName: 'Otro', inviteToken: inv.body.token }).expect(403);
    expect(other.body.code).toBe('INVITATION_REQUIRED');
    const ok = await http.post('/api/v1/auth/register').send({ email, password: 'secreto-1234', fullName: 'Luis Cliente', inviteToken: inv.body.token }).expect(201);
    const me = await http.get('/api/v1/me').set(bearer(ok.body.accessToken)).expect(200);
    expect(me.body.user.emailVerified).toBe(true);
    // Hasta aceptar la invitación no pertenece a ninguna empresa (y no hay espacio personal).
    expect(me.body.workspaces).toEqual([]);
    await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(ok.body.accessToken)).expect(200);
    expect((await http.get('/api/v1/me').set(bearer(ok.body.accessToken))).body.workspaces).toHaveLength(1);
  });
});
