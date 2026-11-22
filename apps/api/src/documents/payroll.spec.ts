import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { payslipPdf, textPdf } from '../demo/assets';
import { PrismaService } from '../prisma/prisma.service';
import { Storage } from '../storage/storage';
import { bearer, bootApp } from '../testing/boot';
import { DocumentJobsService } from './document-jobs.service';

const binary = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

async function merge(parts: Buffer[]): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const p of parts) {
    const doc = await PDFDocument.load(p);
    for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
  }
  return Buffer.from(await out.save());
}

describe('Nóminas, registro mensual y plazos de los documentos', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let jobs: DocumentJobsService;
  const run = randomUUID().slice(0, 8);
  let boss: string;
  let bossId: string;
  let orgId: string;
  const people: Record<'ana' | 'luis' | 'olga', { token: string; id: string; dni: string }> = {} as never;
  const as = (token: string) => ({ ...bearer(token), 'X-Workspace': orgId });
  const signUp = async (name: string) => {
    const email = `${name}.${run}@payroll.dev`;
    const res = await http.post('/api/v1/auth/register').send({ email, password: 'secreto-1234', fullName: `${name} Nómina` }).expect(201);
    return { token: res.body.accessToken as string, email };
  };
  const inbox = async (token: string) => (await http.get('/api/v1/documents/inbox').set(as(token)).expect(200)).body as { id: string; title: string; category: string; period: string | null; dueDate: string | null; requiresSignature: boolean; overdue: boolean }[];

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    prisma = app.get(PrismaService);
    jobs = app.get(DocumentJobsService);
    const b = await signUp('jefa');
    boss = b.token;
    bossId = (await http.get('/api/v1/me').set(bearer(boss))).body.user.id;
    orgId = (await http.post('/api/v1/organizations').set(bearer(boss)).send({ name: `Nóminas ${run}` }).expect(201)).body.organizationId;
    const dnis = { ana: '12345678Z', luis: '11111111H', olga: 'X1234567L' } as const;
    for (const name of ['ana', 'luis', 'olga'] as const) {
      const who = await signUp(name);
      const inv = await http.post('/api/v1/invitations').set(as(boss)).send({ email: who.email }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(who.token)).expect(200);
      const id = (await http.get('/api/v1/me').set(bearer(who.token))).body.user.id as string;
      await prisma.user.update({ where: { id }, data: { dniNie: dnis[name] } });
      people[name] = { token: who.token, id, dni: dnis[name] };
    }
  });
  afterAll(() => app.close());

  it('reparte un PDF de nóminas por DNI: cada persona recibe solo sus páginas', async () => {
    const slip = (name: string, dni: string) => payslipPdf({ company: 'Nóminas S.L.', taxId: 'B00000000', name, dni, month: 'octubre 2026', gross: 2000, net: 1600 });
    const pdf = await merge([
      await slip('Ana', '12345678Z'),
      await slip('Ana (hoja 2)', '12345678-Z'),
      await slip('Luis', '11.111.111-H'),
      await textPdf('Resumen de la gestoría', 'Sin datos personales', ['Totales de la empresa.']),
      await slip('Olga', 'X1234567L'),
    ]);
    await http.post('/api/v1/documents/payroll').set(as(people.ana.token)).attach('file', pdf, 'nominas.pdf').expect(403);
    const analysis = (await http.post('/api/v1/documents/payroll').set(as(boss)).attach('file', pdf, 'nominas-octubre.pdf').expect(200)).body;
    expect(analysis.pageCount).toBe(5);
    expect(analysis.pages).toEqual([
      { page: 1, dni: '12345678Z', userId: people.ana.id },
      { page: 2, dni: '12345678Z', userId: people.ana.id },
      { page: 3, dni: '11111111H', userId: people.luis.id },
      { page: 4, dni: null, userId: null },
      { page: 5, dni: 'X1234567L', userId: people.olga.id },
    ]);
    expect(analysis.people.map((p: { fullName: string }) => p.fullName)).toContain('ana Nómina');

    // La página 4 no es de nadie: no se envía. La 5 se reasigna a mano a Luis, por ejemplo.
    const assignments = [
      { page: 1, userId: people.ana.id },
      { page: 2, userId: people.ana.id },
      { page: 3, userId: people.luis.id },
      { page: 5, userId: people.olga.id },
    ];
    await http.post(`/api/v1/documents/payroll/${analysis.id}/send`).set(as(boss)).send({ title: 'Nómina de octubre', assignments: [...assignments, { page: 1, userId: people.luis.id }] }).expect(400);
    expect((await http.post(`/api/v1/documents/payroll/${analysis.id}/send`).set(as(boss)).send({ title: 'Nómina de octubre', assignments }).expect(200)).body).toEqual({ sent: 3 });

    const anaDocs = await inbox(people.ana.token);
    expect(anaDocs).toEqual([expect.objectContaining({ title: 'Nómina de octubre', category: 'PAYROLL', requiresSignature: false })]);
    const body = await binary(http.get(`/api/v1/documents/${anaDocs[0]!.id}/content/original`).set(as(people.ana.token))).expect(200);
    expect((await PDFDocument.load(body.body as Buffer)).getPageCount()).toBe(2);
    // El PDF subido se borra al enviar: ya no se puede reutilizar.
    await http.post(`/api/v1/documents/payroll/${analysis.id}/send`).set(as(boss)).send({ title: 'Otra vez', assignments }).expect(404);
    expect(await prisma.payrollImport.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it('lo subido y no enviado se borra a las 24 h', async () => {
    const pdf = await payslipPdf({ company: 'X', taxId: 'B00000000', name: 'Ana', dni: '12345678Z', month: 'x', gross: 1, net: 1 });
    const { id } = (await http.post('/api/v1/documents/payroll').set(as(boss)).attach('file', pdf, 'n.pdf').expect(200)).body;
    const row = await prisma.payrollImport.findUniqueOrThrow({ where: { id } });
    await prisma.payrollImport.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await app.get(require('./payroll.service').PayrollService).purgeExpired(new Date());
    expect(await prisma.payrollImport.count({ where: { id } })).toBe(0);
    await expect(app.get(Storage).get(row.fileKey)).rejects.toThrow();
    await http.post('/api/v1/documents/payroll').set(as(boss)).attach('file', Buffer.from('no es un pdf'), 'n.pdf').expect(400).expect((r) => expect(r.body.code).toBe('PAYROLL_UNREADABLE'));
  });

  it('registro mensual: a quien trabajó ese mes, para firmar con plazo, una sola vez; y la tarea lo envía sola', async () => {
    const entry = (userId: string, start: string, end: string) =>
      prisma.timeEntry.create({ data: { organizationId: orgId, userId, workdayId: randomUUID(), entryType: 'WORK', startTime: new Date(start), endTime: new Date(end) } });
    await entry(people.ana.id, '2026-10-06T06:00:00Z', '2026-10-06T14:00:00Z');
    await entry(people.luis.id, '2026-10-07T06:00:00Z', '2026-10-07T13:30:00Z');
    await entry(people.ana.id, '2026-09-15T06:00:00Z', '2026-09-15T14:00:00Z');

    await http.post('/api/v1/documents/timesheets').set(as(people.ana.token)).send({ month: '2026-10' }).expect(403);
    expect((await http.post('/api/v1/documents/timesheets').set(as(boss)).send({ month: '2026-10' }).expect(200)).body).toEqual({ sent: 2, skipped: 0 });
    expect((await http.post('/api/v1/documents/timesheets').set(as(boss)).send({ month: '2026-10' }).expect(200)).body).toEqual({ sent: 0, skipped: 2 });
    const doc = (await inbox(people.luis.token)).find((d) => d.category === 'TIMESHEET')!;
    expect(doc).toMatchObject({ title: 'Registro de jornada de octubre de 2026', period: '2026-10', requiresSignature: true, dueDate: expect.any(String) });
    expect((await inbox(people.olga.token)).filter((d) => d.category === 'TIMESHEET')).toEqual([]); // no trabajó

    // La tarea: con el envío activado, a partir del día elegido manda el mes anterior.
    const org = (await http.get('/api/v1/organization').set(as(boss))).body;
    const { id: _i, currency: _c, ...dto } = org;
    await http.patch('/api/v1/organization').set(as(boss)).send({ ...dto, monthlyTimesheet: { enabled: true, day: 3, requireSignature: false } }).expect(200);
    await jobs.monthly(new Date('2026-10-02T10:00:00Z')); // aún no es el día 3
    expect((await inbox(people.ana.token)).filter((d) => d.period === '2026-09')).toEqual([]);
    await jobs.monthly(new Date('2026-10-05T10:00:00Z'));
    await jobs.monthly(new Date('2026-10-06T10:00:00Z'));
    expect((await inbox(people.ana.token)).filter((d) => d.period === '2026-09')).toEqual([expect.objectContaining({ requiresSignature: false })]);
  });

  it('registro de toda la plantilla: Excel con resumen y una hoja por persona, o un PDF con todos', async () => {
    const xlsx = await binary(http.get('/api/v1/reports/team-timesheet?month=2026-10&format=xlsx').set(as(boss))).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Resumen', 'ana Nómina', 'jefa Nómina', 'luis Nómina', 'olga Nómina']);
    const summary = wb.getWorksheet('Resumen')!;
    const ana = summary.getRows(5, 4)!.find((r) => r.getCell(1).value === 'ana Nómina')!;
    expect([ana.getCell(2).value, ana.getCell(3).value, ana.getCell(4).value]).toEqual(['12345678Z', 1, 8]);
    const pdf = await binary(http.get('/api/v1/reports/team-timesheet?month=2026-10&format=pdf').set(as(boss))).expect(200);
    expect((await PDFDocument.load(pdf.body as Buffer)).getPageCount()).toBeGreaterThanOrEqual(4);
    await http.get('/api/v1/reports/team-timesheet?month=2026-10').set(as(people.ana.token)).expect(403);
  });

  it('plazo de un documento: aviso 3 días antes, el día y cada 3 días ya vencido (hasta 3 veces)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const inDays = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000);
    const due = inDays(3).toISOString().slice(0, 10);
    const file = await textPdf('Normas de obra', 'Leer y firmar', ['Texto.']);
    await http
      .post('/api/v1/documents')
      .set(as(boss))
      .field('data', JSON.stringify({ title: 'Normas de obra', category: 'SAFETY', requiresSignature: false, recipients: [people.olga.id], dueDate: due }))
      .attach('file', file, 'normas.pdf')
      .expect(201);
    const reminders = async () =>
      (await prisma.notification.findMany({ where: { userId: people.olga.id, type: 'DOCUMENT_REMINDER' }, orderBy: { createdAt: 'asc' } })).map((n) => (n.payload as { overdue: boolean }).overdue);

    await jobs.remind(inDays(0));
    await jobs.remind(inDays(0)); // una vez al día
    await jobs.remind(inDays(1)); // ningún aviso entre medias
    await jobs.remind(inDays(3));
    for (const d of [4, 6, 9, 12, 15]) await jobs.remind(inDays(d));
    expect(await reminders()).toEqual([false, false, true, true, true]);

    // Vencido y sin leer: así se ve en su bandeja. Al leerlo, deja de estar vencido.
    const doc = (await inbox(people.olga.token)).find((d) => d.title === 'Normas de obra')!;
    await prisma.document.update({ where: { id: doc.id }, data: { dueDate: new Date(`${inDays(-1).toISOString().slice(0, 10)}T00:00:00Z`) } });
    expect((await inbox(people.olga.token)).find((d) => d.id === doc.id)!.overdue).toBe(true);
    await http.post(`/api/v1/documents/${doc.id}/acknowledge`).set(as(people.olga.token)).expect(200);
    expect((await inbox(people.olga.token)).find((d) => d.id === doc.id)!.overdue).toBe(false);
  });

  it('se puede enviar a un departamento entero', async () => {
    const dept = (await http.post('/api/v1/departments').set(as(boss)).send({ name: 'Taller' }).expect(201)).body;
    for (const p of [people.ana, people.luis]) {
      const m = await prisma.membership.findFirstOrThrow({ where: { organizationId: orgId, userId: p.id } });
      await http.patch(`/api/v1/members/${m.id}`).set(as(boss)).send({ departmentId: dept.id }).expect(204);
    }
    const file = await textPdf('Turnos del taller', '', ['Texto.']);
    const sent = (
      await http
        .post('/api/v1/documents')
        .set(as(boss))
        .field('data', JSON.stringify({ title: 'Turnos del taller', category: 'ANNOUNCEMENT', requiresSignature: false, recipients: { departmentId: dept.id } }))
        .attach('file', file, 'taller.pdf')
        .expect(201)
    ).body;
    expect(sent.map((d: { recipient: { id: string } }) => d.recipient.id).sort()).toEqual([people.ana.id, people.luis.id].sort());
    expect(sent.every((d: { sender: { id: string } }) => d.sender.id === bossId)).toBe(true);
  });
});
