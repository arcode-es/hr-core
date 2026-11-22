import type { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp } from '../testing/boot';

/** Regresiones de los hallazgos de la auditoría de seguridad de noviembre de 2026. */
describe('Correcciones de la auditoría de seguridad', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const mail = (n: string) => `${n}.${run}@auditoria.dev`;
  const password = 'secreto-1234';
  const as = (token: string, org: string) => ({ ...bearer(token), 'X-Workspace': org });

  const signUp = async (name: string, fullName = `${name} Prueba`) =>
    (await http.post('/api/v1/auth/register').send({ email: mail(name), password, fullName }).expect(201)).body.accessToken as string;
  const join = async (adminToken: string, org: string, name: string, role = 'EMPLOYEE', fullName?: string) => {
    const inv = await http.post('/api/v1/invitations').set(as(adminToken, org)).send({ email: mail(name), role }).expect(201);
    const token = (await http.post('/api/v1/auth/register').send({ email: mail(name), password, fullName: fullName ?? `${name} Prueba`, inviteToken: inv.body.token }).expect(201)).body.accessToken as string;
    await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(token)).expect(200);
    return token;
  };
  const clock = (token: string, org: string, data: Record<string, unknown>) =>
    http.post('/api/v1/time/clock').set(as(token, org)).field('data', JSON.stringify({ position: null, clientTime: new Date().toISOString(), clientUuid: randomUUID(), ...data }));

  let admin: string;
  let org: string;

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', LOGIN_MAX_ATTEMPTS: '3', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    prisma = app.get(PrismaService);
    admin = await signUp('jefa');
    org = (await http.post('/api/v1/organizations').set(bearer(admin)).send({ name: `Auditada ${run} S.L.` }).expect(201)).body.organizationId;
  });
  afterAll(() => app.close());

  it('el bloqueo de la cuenta salta aunque los intentos fallidos lleguen a la vez', async () => {
    await signUp('victima');
    const tries = await Promise.all(Array.from({ length: 12 }, (_, i) => http.post('/api/v1/auth/login').send({ email: mail('victima'), password: `mala-${i}-xxxxx` })));
    expect(tries.every((r) => r.status === 401 || r.status === 403)).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: mail('victima') } });
    expect(user.lockedUntil).not.toBeNull();
    // Bloqueada: ni con la contraseña buena se entra hasta que pase el plazo.
    expect((await http.post('/api/v1/auth/login').send({ email: mail('victima'), password }).expect(403)).body.code).toBe('ACCOUNT_LOCKED');
  });

  it('un fichaje con fecha pasada no puede solaparse con tiempo ya registrado', async () => {
    const worker = await join(admin, org, 'obrero');
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    await clock(worker, org, { action: 'START', occurredAt: ago(50), clientTime: ago(50) }).expect(200);
    await clock(worker, org, { action: 'STOP', occurredAt: ago(42), clientTime: ago(42) }).expect(200);
    // Empezar dentro de esa jornada: rechazado.
    expect((await clock(worker, org, { action: 'START', occurredAt: ago(45), clientTime: ago(45) }).expect(409)).body.code).toBe('OFFLINE_EVENT_REJECTED');
    // Empezar antes y cerrar por encima: la entrada se acepta, el cierre que la envolvería no.
    await clock(worker, org, { action: 'START', occurredAt: ago(60), clientTime: ago(60) }).expect(200);
    expect((await clock(worker, org, { action: 'STOP', occurredAt: ago(30), clientTime: ago(30) }).expect(409)).body.code).toBe('OFFLINE_EVENT_REJECTED');
    await clock(worker, org, { action: 'STOP', occurredAt: ago(55), clientTime: ago(55) }).expect(200);
  });

  it('quien supervisa un departamento no ve fotos, historial ni justificantes de otro', async () => {
    const boss = await join(admin, org, 'encargada', 'MANAGER');
    const other = await join(admin, org, 'ajeno');
    const members = (await http.get('/api/v1/members').set(as(admin, org)).expect(200)).body as { id: string; email: string; userId: string }[];
    const of = (n: string) => members.find((m) => m.email === mail(n))!;
    const deptA = (await http.post('/api/v1/departments').set(as(admin, org)).send({ name: 'Obra A' }).expect(201)).body.id;
    const deptB = (await http.post('/api/v1/departments').set(as(admin, org)).send({ name: 'Obra B' }).expect(201)).body.id;
    await http.put(`/api/v1/departments/${deptA}/managers`).set(as(admin, org)).send({ membershipIds: [of('encargada').id] }).expect(200);
    await http.patch(`/api/v1/members/${of('ajeno').id}`).set(as(admin, org)).send({ departmentId: deptB }).expect(204);

    await clock(other, org, { action: 'START' }).expect(200);
    await clock(other, org, { action: 'STOP' }).expect(200);
    const entry = await prisma.timeEntry.findFirstOrThrow({ where: { userId: of('ajeno').userId, organizationId: org } });
    await prisma.timeEntry.update({ where: { id: entry.id }, data: { startPhotoKey: `time/${of('ajeno').userId}/2026/11/prueba-start.jpg` } });
    const absence = await prisma.absence.create({
      data: { organizationId: org, userId: of('ajeno').userId, type: 'SICK_LEAVE', startDate: new Date('2026-11-02'), endDate: new Date('2026-11-03'), days: 2, status: 'APPROVED', attachmentKey: `absences/${org}/prueba.pdf` },
    });

    await http.get(`/api/v1/time/entries/${entry.id}/photo/start`).set(as(boss, org)).expect(404);
    await http.get(`/api/v1/time/workdays/${entry.workdayId}/audit`).set(as(boss, org)).expect(404);
    await http.get(`/api/v1/absences/${absence.id}/attachment`).set(as(boss, org)).expect(404);
    // La administración y la propia persona sí.
    await http.get(`/api/v1/time/entries/${entry.id}/photo/start`).set(as(admin, org)).expect(200);
    await http.get(`/api/v1/absences/${absence.id}/attachment`).set(as(other, org)).expect(200);
  });

  it('una hoja de cálculo pequeña que se expande a cientos de megas se rechaza sin cargarla', async () => {
    const rows = Array.from({ length: 150_000 }, (_, i) => `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>n${i}</t></is></c><c r="B${i + 2}" t="inlineStr"><is><t>a${i}@x.dev</t></is></c></row>`).join('');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoja" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nombre</t></is></c><c r="B1" t="inlineStr"><is><t>Correo</t></is></c></row>${rows}</sheetData></worksheet>`);
    const file = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    expect(file.length).toBeLessThan(2 * 1024 * 1024);
    const before = process.memoryUsage().heapUsed;
    const res = await http.post('/api/v1/invitations/import/preview').set(as(admin, org)).attach('file', file, 'plantilla.xlsx').expect(400);
    expect(res.body.code).toBe('IMPORT_UNREADABLE');
    // Antes subía más de 300 MB; ahora ni se descomprime.
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(120 * 1024 * 1024);
  });

  it('la última administradora no puede borrar su cuenta y dejar la empresa sin administración', async () => {
    expect((await http.post('/api/v1/me/delete').set(bearer(admin)).send({ password }).expect(409)).body.code).toBe('LAST_ADMIN');
    expect(await prisma.membership.count({ where: { organizationId: org, role: 'ADMIN', active: true } })).toBe(1);
  });

  it('un nombre que Excel no admite como hoja no rompe la exportación del equipo', async () => {
    await join(admin, org, 'historia', 'EMPLOYEE', 'History');
    await join(admin, org, 'comilla', 'EMPLOYEE', "'Ana'");
    const month = new Date().toISOString().slice(0, 7);
    await http.get(`/api/v1/reports/team-timesheet?month=${month}&format=xlsx`).set(as(admin, org)).expect(200);
  });

  it('los avisos push solo se envían a servicios públicos por https, nunca a equipos internos', async () => {
    const keys = { p256dh: 'BPk', auth: 'YXV0aA' };
    for (const endpoint of ['https://127.0.0.1/x', 'http://fcm.googleapis.com/x', 'https://localhost/x', 'https://servidor/x', 'https://api.internal/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'https://[::1]/x']) {
      await http.post('/api/v1/push/subscribe').set(bearer(admin)).send({ endpoint, keys }).expect(400);
    }
    await http.post('/api/v1/push/subscribe').set(bearer(admin)).send({ endpoint: `https://fcm.googleapis.com/fcm/send/${run}`, keys }).expect((r) => expect(r.status).toBeLessThan(300));
  });
});
