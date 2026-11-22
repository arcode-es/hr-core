import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { DEMO_ACCOUNTS } from '../demo/accounts';
import { DemoService } from '../demo/demo.service';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp } from '../testing/boot';

/** La demo pública: sin registro, sin correo, cuentas de prueba protegidas y reinicio nocturno. */
describe('Modo demo', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const password = 'Demo-Prueba-2026';
  const login = async (email: string): Promise<string> =>
    (await http.post('/api/v1/auth/login').send({ email, password }).expect(200)).body.accessToken as string;
  const [admin, manager, luis] = DEMO_ACCOUNTS.map((a) => a.email);

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'demo', DEMO_PASSWORD: password, AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    prisma = app.get(PrismaService);
    await app.get(DemoService).reset(new Date());
  }, 60_000);
  afterAll(() => app.close());

  it('publica las cuentas de prueba y su contraseña', async () => {
    const res = await http.get('/api/v1/meta').expect(200);
    expect(res.body.mode).toBe('demo');
    expect(res.body.demo.password).toBe(password);
    expect(res.body.demo.accounts.map((a: { role: string }) => a.role)).toEqual(['ADMIN', 'MANAGER', 'EMPLOYEE', 'EMPLOYEE', 'INSPECTOR']);
  });

  it('no deja registrarse ni crear empresas', async () => {
    const reg = await http.post('/api/v1/auth/register').send({ email: `visita.${randomUUID().slice(0, 8)}@test.dev`, password: 'secreto-1234', fullName: 'Visita' }).expect(403);
    expect(reg.body.code).toBe('REGISTRATION_CLOSED');
    const token = await login(admin!);
    const org = await http.post('/api/v1/organizations').set(bearer(token)).send({ name: 'Otra empresa' }).expect(403);
    expect(org.body.code).toBe('ORG_CREATION_DISABLED');
  });

  it('cada cuenta entra directamente en la empresa demo, sin espacio personal', async () => {
    const me = await http.get('/api/v1/me').set(bearer(await login(luis!))).expect(200);
    expect(me.body.workspaces).toHaveLength(1);
    expect(me.body.workspaces[0]).toMatchObject({ kind: 'organization', role: 'EMPLOYEE', name: 'Construcciones Levante S.L.' });
  });

  it('protege lo que dejaría la demo inservible para el siguiente visitante', async () => {
    const token = await login(admin!);
    const ws = (await http.get('/api/v1/me').set(bearer(token))).body.workspaces[0].organizationId as string;
    const pw = await http.post('/api/v1/auth/password').set(bearer(token)).send({ currentPassword: password, newPassword: 'otra-clave-1234' }).expect(403);
    expect(pw.body.code).toBe('DEMO_READ_ONLY');
    const members = (await http.get('/api/v1/members').set(bearer(token)).set('X-Workspace', ws)).body as { id: string; email: string }[];
    const target = members.find((m) => m.email === manager)!;
    const change = await http.patch(`/api/v1/members/${target.id}`).set(bearer(token)).set('X-Workspace', ws).send({ active: false }).expect(403);
    expect(change.body.code).toBe('DEMO_READ_ONLY');
    // Con claves falsas no se bloquea la cuenta de nadie.
    for (let i = 0; i < 7; i++) await http.post('/api/v1/auth/login').send({ email: manager, password: 'mala-clave' }).expect(401);
    await login(manager!);
  });

  it('las invitaciones se crean, pero no se envía ningún correo', async () => {
    const token = await login(admin!);
    const ws = (await http.get('/api/v1/me').set(bearer(token))).body.workspaces[0].organizationId as string;
    const inv = await http.post('/api/v1/invitations').set(bearer(token)).set('X-Workspace', ws).send({ email: `alguien.${randomUUID().slice(0, 8)}@test.dev`, role: 'EMPLOYEE' }).expect(201);
    expect(inv.body.emailed).toBe(false);
    expect(inv.body.token).toBeTruthy();
  });

  it('trae actividad de ejemplo: pendientes de validar, gastos y documentos en todos los estados', async () => {
    const org = await prisma.organization.findFirstOrThrow({ where: { isDemo: true } });
    const [pending, statuses, docs, photos] = await Promise.all([
      prisma.timeEntry.count({ where: { organizationId: org.id, approvalStatus: 'PENDING' } }),
      prisma.expense.groupBy({ by: ['status'], where: { organizationId: org.id } }),
      prisma.document.groupBy({ by: ['status'], where: { organizationId: org.id } }),
      prisma.timeEntry.count({ where: { organizationId: org.id, startPhotoKey: { not: null } } }),
    ]);
    expect(pending).toBeGreaterThan(0);
    expect(statuses.map((s) => s.status).sort()).toEqual(['APPROVED', 'PENDING', 'REIMBURSED', 'REJECTED']);
    expect(docs.map((d) => d.status).sort()).toEqual(['SENT', 'SIGNED', 'VIEWED']);
    expect(photos).toBeGreaterThan(0);
  });

  /** Filas de la empresa demo en cada tabla: lo que debe quedar igual tras cada reinicio. */
  const snapshot = async (): Promise<Record<string, number>> => {
    const org = { organization: { isDemo: true } };
    const counts = await Promise.all([
      prisma.membership.count({ where: org }),
      prisma.location.count({ where: org }),
      prisma.shift.count({ where: org }),
      prisma.timeEntry.count({ where: org }),
      prisma.expense.count({ where: org }),
      prisma.document.count({ where: org }),
      prisma.absence.count({ where: org }),
      prisma.holiday.count({ where: org }),
      prisma.alert.count({ where: org }),
      prisma.notification.count({ where: org }),
      prisma.department.count({ where: org }),
      prisma.departmentManager.count({ where: { department: org } }),
      prisma.invitation.count({ where: org }),
      prisma.shiftPattern.count({ where: org }),
      prisma.kioskDevice.count({ where: org }),
      prisma.payrollImport.count({ where: org }),
    ]);
    const names = ['membership', 'location', 'shift', 'timeEntry', 'expense', 'document', 'absence', 'holiday', 'alert', 'notification', 'department', 'departmentManager', 'invitation', 'shiftPattern', 'kioskDevice', 'payrollImport'];
    return Object.fromEntries(names.map((n, i) => [n, counts[i]!]));
  };

  it('el reinicio borra lo que hicieron los visitantes y deja exactamente lo mismo', async () => {
    await app.get(DemoService).reset(new Date());
    const before = await snapshot();
    expect(before).toMatchObject({ department: 2, departmentManager: 1, invitation: 2, shiftPattern: 1, kioskDevice: 1, payrollImport: 0 });
    expect(before.alert).toBeGreaterThanOrEqual(1);
    expect(before.timeEntry).toBeGreaterThan(50);

    // Lo que haría un visitante: fichar, crear un departamento, un quiosco, un patrón, subir nóminas.
    const token = await login(luis!);
    const ws = (await http.get('/api/v1/me').set(bearer(token))).body.workspaces[0].organizationId as string;
    await http
      .post('/api/v1/time/clock')
      .set(bearer(token))
      .set('X-Workspace', ws)
      .field('data', JSON.stringify({ action: 'START', position: null, clientTime: new Date().toISOString(), clientUuid: randomUUID() }))
      .expect(200);
    const as = { ...bearer(await login(admin!)), 'X-Workspace': ws };
    await http.post('/api/v1/departments').set(as).send({ name: 'Visitantes' }).expect(201);
    await http.post('/api/v1/kiosks').set(as).send({ name: 'Tablet de prueba' }).expect(201);
    await http.post('/api/v1/shift-patterns').set(as).send({ name: 'Prueba', days: [{ start: '08:00', end: '12:00' }, null] }).expect(201);
    const sample = await http.get('/api/v1/documents/payroll/sample.pdf').set(as).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const analysis = (await http.post('/api/v1/documents/payroll').set(as).attach('file', sample.body as Buffer, 'nominas.pdf').expect(200)).body;
    // El PDF de ejemplo trae una página por persona con DNI y una de totales sin dueño.
    expect(analysis.pages.filter((p: { userId: string | null }) => p.userId)).toHaveLength(4);
    expect(analysis.pages.at(-1)).toMatchObject({ dni: null, userId: null });
    expect(await snapshot()).not.toEqual(before);

    await app.get(DemoService).reset(new Date());
    expect(await prisma.organization.count({ where: { isDemo: true } })).toBe(1);
    expect(await snapshot()).toEqual(before);
  }, 120_000);

  it('la purga solo alcanza a la empresa demo: los fichajes reales siguen sin poder borrarse', async () => {
    const real = await prisma.timeEntry.findFirst({ where: { organization: { isDemo: false } }, select: { id: true } });
    if (!real) return;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('hr.demo_purge', 'on', true)`;
        await tx.timeEntry.delete({ where: { id: real.id } });
      }),
    ).rejects.toThrow(/inmutable/);
  });
});
