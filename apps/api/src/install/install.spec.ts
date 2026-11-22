import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { bootApp } from '../testing/boot';
import { InstallService } from './install.service';

describe('Instalación desde el servidor', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let install: InstallService;
  const run = randomUUID().slice(0, 8);
  const email = `jefa.${run}@empresa.test`;
  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'client', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    install = app.get(InstallService);
  });
  afterAll(() => app.close());

  it('crea la empresa con su administración y un enlace para elegir contraseña', async () => {
    const r = await install.createOrganization({ name: `Empresa ${run}`, adminEmail: email, adminName: 'Jefa Pruebas' });
    await http.post('/api/v1/auth/reset-password').send({ token: tokenOf(r.setupUrl), newPassword: 'Primera-clave-2026' }).expect(204);
    const login = await http.post('/api/v1/auth/login').send({ email, password: 'Primera-clave-2026' }).expect(200);
    expect(login.body.accessToken).toEqual(expect.any(String));
  });

  it('reset-link recupera el acceso: invalida los enlaces anteriores y quita el bloqueo por intentos', async () => {
    const prisma = app.get(PrismaService);
    await prisma.user.update({ where: { email }, data: { failedLogins: 9, lockedUntil: new Date(Date.now() + 3_600_000) } });
    const viejo = await install.resetLink(email);
    const nuevo = await install.resetLink(email.toUpperCase());
    await http.post('/api/v1/auth/reset-password').send({ token: tokenOf(viejo), newPassword: 'Clave-vieja-2026' }).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
    await http.post('/api/v1/auth/reset-password').send({ token: tokenOf(nuevo), newPassword: 'Segunda-clave-2026' }).expect(204);
    await http.post('/api/v1/auth/login').send({ email, password: 'Segunda-clave-2026' }).expect(200);
    await expect(install.resetLink(`nadie.${run}@empresa.test`)).rejects.toThrow(/No hay ninguna cuenta/);
  });
});
