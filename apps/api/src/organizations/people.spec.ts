import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { validDniNie, findDnis } from '../common/dni';
import { LogMailer, Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp } from '../testing/boot';
import { parseCsv } from './import';

describe('DNI/NIE y CSV', () => {
  it('comprueba la letra de control y encuentra DNI/NIE en un texto', () => {
    expect(validDniNie('12345678Z')).toBe(true);
    expect(validDniNie('12.345.678-z')).toBe(true);
    expect(validDniNie('12345678A')).toBe(false);
    expect(validDniNie('X1234567L')).toBe(true);
    expect(validDniNie('B12345678')).toBe(false);
    expect(findDnis('Empresa B00000000 · Trabajador 11111111-H · NAF 280123456789 · otro 12345678A')).toEqual(['11111111H']);
  });

  it('lee CSV con «;», comillas, saltos de línea entre comillas y BOM', () => {
    expect(parseCsv('﻿Nombre;Correo\n"Pérez; Ana";ana@x.es\r\n"Línea\ndoble";"b@x.es"\n\n')).toEqual([
      ['Nombre', 'Correo'],
      ['Pérez; Ana', 'ana@x.es'],
      ['Línea\ndoble', 'b@x.es'],
    ]);
  });
});

describe('Personas: alta masiva, invitaciones y departamentos', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let mailer: LogMailer;
  const run = randomUUID().slice(0, 8);
  const mail = (name: string) => `${name}.${run}@people.dev`;
  let boss: string;
  let orgId: string;
  const as = (token: string) => ({ ...bearer(token), 'X-Workspace': orgId });
  const signUp = async (name: string) => (await http.post('/api/v1/auth/register').send({ email: mail(name), password: 'secreto-1234', fullName: `${name} Persona` }).expect(201)).body.accessToken as string;
  const tokenFrom = (to: string) => /\/invite\/([A-Za-z0-9_-]+)/.exec(mailer.outbox.filter((m) => m.to === to).at(-1)!.text)![1]!;

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000', INVITES_PER_DAY: '8' }));
    prisma = app.get(PrismaService);
    mailer = app.get(Mailer) as LogMailer;
    boss = await signUp('jefa');
    orgId = (await http.post('/api/v1/organizations').set(bearer(boss)).send({ name: `Personas ${run}` }).expect(201)).body.organizationId;
  });
  afterAll(async () => {
    delete process.env.INVITES_PER_DAY;
    await app.close();
  });

  it('la plantilla descargable se puede volver a subir tal cual', async () => {
    const res = await http
      .get('/api/v1/invitations/import/template.xlsx')
      .set(as(boss))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const preview = await http.post('/api/v1/invitations/import/preview').set(as(boss)).attach('file', res.body as Buffer, 'plantilla.xlsx').expect(200);
    expect(preview.body.columns).toEqual(['fullName', 'email', 'dniNie', 'role', 'department', 'jobTitle', 'weeklyHours']);
    expect(preview.body.rows.map((r: { role: string; errors: string[] }) => [r.role, r.errors])).toEqual([
      ['EMPLOYEE', []],
      ['MANAGER', []],
    ]);
  });

  it('marca los errores fila a fila y no crea nada al previsualizar', async () => {
    const csv = [
      'Correo;Nombre y apellidos;DNI;Rol;Departamento;Horas semanales',
      `${mail('ana')};Ana Ruiz;12345678Z;Empleada;Obra;40`,
      `${mail('ana')};Ana Repetida;;;;`,
      `no-es-correo;Sin Correo;;;;`,
      `${mail('bad')};D;12345678A;Jefazo;;90`,
      `${mail('jefa')};La Jefa;;Administrador;;`,
    ].join('\n');
    const res = await http.post('/api/v1/invitations/import/preview').set(as(boss)).attach('file', Buffer.from(csv), 'equipo.csv').expect(200);
    expect(res.body.rows.map((r: { line: number; errors: string[] }) => [r.line, r.errors])).toEqual([
      [2, []],
      [3, ['DUPLICATE']],
      [4, ['EMAIL']],
      [5, ['NAME', 'DNI', 'ROLE', 'HOURS']],
      [6, ['MEMBER']],
    ]);
    expect(res.body.rows[0]).toMatchObject({ fullName: 'Ana Ruiz', dniNie: '12345678Z', role: 'EMPLOYEE', department: 'Obra', weeklyHours: 40 });
    expect(await prisma.invitation.count({ where: { organizationId: orgId } })).toBe(0);
    await http.post('/api/v1/invitations/import/preview').set(as(boss)).attach('file', Buffer.from('a;b\n1;2'), 'x.csv').expect(400).expect((r) => expect(r.body.code).toBe('IMPORT_UNREADABLE'));
  });

  it('importa: crea departamentos, invita con los datos precargados y se aplican al aceptar', async () => {
    const rows = [
      { email: mail('ana'), fullName: 'Ana Ruiz', dniNie: '12345678Z', role: 'EMPLOYEE', department: 'Obra', jobTitle: 'Oficial', weeklyHours: 40 },
      { email: mail('marcos'), fullName: 'Marcos Gil', dniNie: null, role: 'MANAGER', department: 'Obra', jobTitle: 'Jefe de obra', weeklyHours: 40 },
      { email: mail('olga'), fullName: 'Olga Sanz', dniNie: 'X1234567L', role: 'EMPLOYEE', department: 'Oficina', jobTitle: null, weeklyHours: 20 },
    ];
    const res = await http.post('/api/v1/invitations/import').set(as(boss)).send({ rows }).expect(201);
    expect(res.body).toEqual({ invited: 3, notEmailed: 0, departmentsCreated: 2 });
    const list = (await http.get('/api/v1/invitations').set(as(boss)).expect(200)).body;
    expect(list.find((i: { email: string }) => i.email === mail('ana'))).toMatchObject({ fullName: 'Ana Ruiz', department: 'Obra', status: 'PENDING', sendCount: 1 });

    // Ana se registra desde el enlace: el nombre viene sugerido y al aceptar recibe su ficha.
    const token = tokenFrom(mail('ana'));
    expect((await http.get(`/api/v1/invite/${token}`).expect(200)).body.fullName).toBe('Ana Ruiz');
    const ana = await signUp('ana');
    await http.post(`/api/v1/invite/${token}/accept`).set(bearer(ana)).expect(200);
    const m = await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, user: { email: mail('ana') } }, include: { user: true, department: true } });
    expect([m.jobTitle, m.department?.name, Number(m.weeklyHours), m.user.dniNie]).toEqual(['Oficial', 'Obra', 40, '12345678Z']);
    const members = (await http.get('/api/v1/members').set(as(boss)).expect(200)).body;
    expect(members.find((x: { email: string }) => x.email === mail('ana'))).toMatchObject({ department: { name: 'Obra' }, weeklyHours: 40 });
    const after = (await http.get('/api/v1/invitations').set(as(boss)).expect(200)).body;
    expect(after.find((i: { email: string }) => i.email === mail('ana')).status).toBe('ACCEPTED');
  });

  it('reenviar cambia el enlace (el anterior deja de valer) y respeta la espera y el límite diario', async () => {
    const inv = (await http.get('/api/v1/invitations').set(as(boss))).body.find((i: { email: string }) => i.email === mail('olga'));
    const old = tokenFrom(mail('olga'));
    await http.post(`/api/v1/invitations/${inv.id}/resend`).set(as(boss)).expect(429); // recién enviada
    await prisma.invitation.update({ where: { id: inv.id }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    const again = (await http.post(`/api/v1/invitations/${inv.id}/resend`).set(as(boss)).expect(200)).body;
    expect(again).toMatchObject({ sendCount: 2, emailed: true });
    expect(tokenFrom(mail('olga'))).not.toBe(old);
    expect((await http.get(`/api/v1/invite/${old}`).expect(404)).body.code).toBe('INVITATION_INVALID');

    // Límite de 8 envíos en 24 h: llevamos 3 (importación); 6 más no caben.
    const many = Array.from({ length: 6 }, (_, i) => ({ email: mail(`extra${i}`), fullName: `Extra ${i}`, dniNie: null, role: 'EMPLOYEE', department: null, jobTitle: null, weeklyHours: null }));
    const denied = await http.post('/api/v1/invitations/import').set(as(boss)).send({ rows: many }).expect(429);
    expect(denied.body.code).toBe('INVITE_LIMIT');
    await http.post('/api/v1/invitations').set(as(boss)).send({ email: mail('una') }).expect(201);
  });

  it('departamentos: un responsable con departamento solo ve y gestiona a su gente', async () => {
    const depts = (await http.get('/api/v1/departments').set(as(boss)).expect(200)).body;
    const obra = depts.find((d: { name: string }) => d.name === 'Obra');
    const oficina = depts.find((d: { name: string }) => d.name === 'Oficina');
    await http.post('/api/v1/departments').set(as(boss)).send({ name: 'Obra' }).expect(409);

    // Marcos (responsable de Obra) y Olga (Oficina) se unen.
    const marcos = await signUp('marcos');
    await http.post(`/api/v1/invite/${tokenFrom(mail('marcos'))}/accept`).set(bearer(marcos)).expect(200);
    const olga = await signUp('olga');
    await http.post(`/api/v1/invite/${tokenFrom(mail('olga'))}/accept`).set(bearer(olga)).expect(200);
    const marcosM = await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, user: { email: mail('marcos') } } });

    // Sin departamento a su cargo ve a todo el mundo; con Obra, solo a Obra (y a sí mismo).
    expect((await http.get('/api/v1/members').set(as(marcos)).expect(200)).body).toHaveLength(4);
    const withManager = (await http.put(`/api/v1/departments/${obra.id}/managers`).set(as(boss)).send({ membershipIds: [marcosM.id] }).expect(200)).body;
    expect(withManager.managers).toEqual([{ membershipId: marcosM.id, fullName: 'marcos Persona' }]);
    expect(withManager.members).toBe(2);
    const seen = (await http.get('/api/v1/members').set(as(marcos)).expect(200)).body.map((x: { email: string }) => x.email).sort();
    expect(seen).toEqual([mail('ana'), mail('marcos')].sort());

    // Olga pide una ausencia: avisa a la jefa (administración), no a Marcos; Marcos ni la ve ni puede decidir.
    const olgaId = (await http.get('/api/v1/me').set(bearer(olga))).body.user.id;
    const absence = await http
      .post('/api/v1/absences')
      .set({ ...bearer(olga), 'X-Workspace': orgId })
      .field('data', JSON.stringify({ type: 'PERSONAL', startDate: '2031-05-06', endDate: '2031-05-06', halfDay: false }))
      .expect(201);
    const marcosId = (await http.get('/api/v1/me').set(bearer(marcos))).body.user.id;
    const bossId = (await http.get('/api/v1/me').set(bearer(boss))).body.user.id;
    const notified = await prisma.notification.findMany({ where: { organizationId: orgId, type: 'ABSENCE_PENDING' }, select: { userId: true } });
    expect(notified.map((n) => n.userId)).toEqual([bossId]);
    expect((await http.get('/api/v1/absences/pending').set(as(marcos)).expect(200)).body).toEqual([]);
    await http.post(`/api/v1/absences/${absence.body.id}/review`).set(as(marcos)).send({ decision: 'APPROVE' }).expect(404);
    await http.get(`/api/v1/reports/timesheet?month=2031-05&userId=${olgaId}`).set(as(marcos)).expect(404);

    // Cambia de departamento: ahora sí la ve.
    const olgaM = await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, userId: olgaId } });
    await http.patch(`/api/v1/members/${olgaM.id}`).set(as(boss)).send({ departmentId: obra.id }).expect(204);
    expect((await http.get('/api/v1/absences/pending').set(as(marcos)).expect(200)).body).toHaveLength(1);
    await http.post(`/api/v1/absences/${absence.body.id}/review`).set(as(marcos)).send({ decision: 'APPROVE' }).expect(200);

    // Borrar el departamento: sus responsables vuelven a ver a toda la empresa.
    await http.delete(`/api/v1/departments/${oficina.id}`).set(as(boss)).expect(204);
    await http.delete(`/api/v1/departments/${obra.id}`).set(as(boss)).expect(204);
    expect((await http.get('/api/v1/members').set(as(marcos)).expect(200)).body).toHaveLength(4);
  });
});
