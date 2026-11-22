import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../app.module';
import { GeoService } from '../geo/geo.service';
import { setupApp } from '../setup';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SIGNATURE = { signature: `data:image/png;base64,${PNG.toString('base64')}`, strokes: 3, points: 140 };

describe('Documentos y firma', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const run = randomUUID().slice(0, 8);
  let pdf: Buffer;

  let boss: string;
  let manager: string;
  let worker: string;
  let mate: string;
  let orgId: string;
  let workerId: string;

  const as = (token: string, ws?: string) => ({ Authorization: `Bearer ${token}`, ...(ws ? { 'X-Workspace': ws } : {}) });
  const signUp = async (name: string): Promise<string> =>
    (await http.post('/api/v1/auth/register').send({ email: `${name}.${run}@doc.dev`, password: 'secreto-1234', fullName: name }).expect(201))
      .body.accessToken;
  const send = (token: string, data: object, file: Buffer = pdf, filename = 'nómina-octubre.pdf') =>
    http.post('/api/v1/documents').set(as(token, orgId)).field('data', JSON.stringify(data)).attach('file', file, { filename, contentType: 'application/pdf' });
  const binary = (req: request.Test) =>
    req.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GeoService)
      .useValue({ reverse: async () => null, search: async () => [] })
      .compile();
    app = mod.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());

    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).drawText('Nómina de octubre', { x: 50, y: 780 });
    doc.addPage([595, 842]).drawText('Página 2', { x: 50, y: 780 });
    pdf = Buffer.from(await doc.save());

    boss = await signUp('jefa');
    manager = await signUp('encargado');
    worker = await signUp('obrero');
    mate = await signUp('colega');
    orgId = (await http.post('/api/v1/organizations').set(as(boss)).send({ name: `Docs ${run}` }).expect(201)).body.organizationId;
    for (const [token, name, role] of [[manager, 'encargado', 'MANAGER'], [worker, 'obrero', 'EMPLOYEE'], [mate, 'colega', 'EMPLOYEE']] as const) {
      const inv = await http.post('/api/v1/invitations').set(as(boss, orgId)).send({ email: `${name}.${run}@doc.dev`, role }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(as(token)).expect(200);
    }
    workerId = (await http.get('/api/v1/me').set(as(worker))).body.user.id;
  });

  afterAll(() => app.close());

  it('no existen documentos en el espacio personal', async () => {
    await http.get('/api/v1/documents/inbox').set(as(worker)).expect(403);
  });

  it('solo admite PDF e imágenes reales, y un PDF dañado no se puede enviar a firmar', async () => {
    const fake = await send(boss, { title: 'Malware', category: 'OTHER', recipients: 'ALL' }, Buffer.from('MZ ejecutable'), 'nomina.pdf').expect(400);
    expect(fake.body.code).toBe('INVALID_DOCUMENT');
    const broken = await send(boss, { title: 'Roto', category: 'CONTRACT', requiresSignature: true, recipients: 'ALL' }, Buffer.from('%PDF-1.7 roto')).expect(400);
    expect(broken.body.code).toBe('INVALID_DOCUMENT');
    await http.post('/api/v1/documents').set(as(boss, orgId)).field('data', JSON.stringify({ title: 'Sin archivo', category: 'OTHER', recipients: 'ALL' })).expect(400);
  });

  let payrollId: string;

  it('enviar a una persona guarda nombre, tamaño y hash del original', async () => {
    const res = await send(boss, { title: 'Nómina de octubre', category: 'PAYROLL', requiresSignature: true, recipients: [workerId] }).expect(201);
    expect(res.body).toHaveLength(1);
    payrollId = res.body[0].id;
    expect(res.body[0]).toMatchObject({
      status: 'SENT',
      requiresSignature: true,
      fileName: 'nómina-octubre.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      sha256: createHash('sha256').update(pdf).digest('hex'),
      recipient: { fullName: 'obrero' },
      sender: { fullName: 'jefa' },
    });
    await send(boss, { title: 'A nadie', category: 'OTHER', recipients: [randomUUID()] }).expect(400);
  });

  it('enviar a toda la plantilla crea un documento por persona, sin incluir al emisor', async () => {
    const res = await send(boss, { title: 'Normas de seguridad', category: 'SAFETY', recipients: 'ALL' }).expect(201);
    expect(res.body.map((d: { recipient: { fullName: string } }) => d.recipient.fullName).sort()).toEqual(['colega', 'encargado', 'obrero']);
    expect(new Set(res.body.map((d: { batchId: string }) => d.batchId)).size).toBe(1);
  });

  it('un empleado solo puede enviar justificantes a sus responsables', async () => {
    await send(worker, { title: 'Nómina falsa', category: 'PAYROLL', recipients: 'ALL' }).expect(403);
    await send(worker, { title: 'Parte', category: 'MEDICAL_LEAVE', recipients: [workerId] }).expect(403);
    await send(worker, { title: 'Parte', category: 'MEDICAL_LEAVE', requiresSignature: true, recipients: 'MANAGERS' }).expect(403);
    const res = await send(worker, { title: 'Parte de baja', category: 'MEDICAL_LEAVE', recipients: 'MANAGERS' }, PNG, 'parte.png').expect(201);
    expect(res.body.map((d: { recipient: { fullName: string } }) => d.recipient.fullName).sort()).toEqual(['encargado', 'jefa']);
    expect(res.body[0].mimeType).toBe('image/png');
  });

  it('cada uno ve su bandeja; un compañero no accede a la nómina de otro', async () => {
    const inbox = await http.get('/api/v1/documents/inbox').set(as(worker, orgId)).expect(200);
    expect(new Set(inbox.body.map((d: { title: string }) => d.title))).toEqual(new Set(['Nómina de octubre', 'Normas de seguridad']));
    await http.get(`/api/v1/documents/${payrollId}`).set(as(mate, orgId)).expect(404);
    await http.get(`/api/v1/documents/${payrollId}/content/original`).set(as(mate, orgId)).expect(404);
    // El encargado no la envió ni la recibe: tampoco. El administrador sí.
    await http.get(`/api/v1/documents/${payrollId}`).set(as(manager, orgId)).expect(404);
    await http.get(`/api/v1/documents/${payrollId}`).set(as(boss, orgId)).expect(200);
    await http.get(`/api/v1/documents/${payrollId}/content/original`).expect(401);
  });

  it('abrir un documento que exige firma lo marca como visto; que lo abra el emisor no', async () => {
    await binary(http.get(`/api/v1/documents/${payrollId}/content/original`).set(as(boss, orgId))).expect(200);
    expect((await http.get(`/api/v1/documents/${payrollId}`).set(as(boss, orgId))).body.status).toBe('SENT');
    const file = await binary(http.get(`/api/v1/documents/${payrollId}/content/original`).set(as(worker, orgId))).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(Buffer.compare(file.body, pdf)).toBe(0);
    const doc = await http.get(`/api/v1/documents/${payrollId}`).set(as(boss, orgId)).expect(200);
    expect(doc.body.status).toBe('VIEWED');
    expect(doc.body.viewedAt).not.toBeNull();
    await http.get(`/api/v1/documents/${payrollId}/content/signed`).set(as(worker, orgId)).expect(404);
  });

  it('la confirmación de lectura es explícita en los documentos sin firma', async () => {
    const inbox = await http.get('/api/v1/documents/inbox').set(as(worker, orgId)).expect(200);
    const safety = inbox.body.find((d: { title: string }) => d.title === 'Normas de seguridad');
    await binary(http.get(`/api/v1/documents/${safety.id}/content/original`).set(as(worker, orgId))).expect(200);
    expect((await http.get(`/api/v1/documents/${safety.id}`).set(as(worker, orgId))).body.status).toBe('SENT');
    await http.post(`/api/v1/documents/${safety.id}/acknowledge`).set(as(boss, orgId)).expect(403);
    const ack = await http.post(`/api/v1/documents/${safety.id}/acknowledge`).set(as(worker, orgId)).expect(200);
    expect(ack.body.status).toBe('VIEWED');
    await http.post(`/api/v1/documents/${safety.id}/sign`).set(as(worker, orgId)).send(SIGNATURE).expect(404);
  });

  it('sin DNI en el perfil no se puede firmar', async () => {
    const res = await http.post(`/api/v1/documents/${payrollId}/sign`).set(as(worker, orgId)).send(SIGNATURE).expect(400);
    expect(res.body.code).toBe('DNI_REQUIRED');
    await http.patch('/api/v1/me').set(as(worker)).send({ dniNie: '12345678Z' }).expect(200);
  });

  it('solo firma el destinatario, con una rúbrica válida', async () => {
    await http.post(`/api/v1/documents/${payrollId}/sign`).set(as(boss, orgId)).send(SIGNATURE).expect(404);
    await http.post(`/api/v1/documents/${payrollId}/sign`).set(as(worker, orgId)).send({ ...SIGNATURE, signature: 'data:text/html;base64,PHNjcmlwdD4=' }).expect(400);
    const notPng = `data:image/png;base64,${Buffer.from('no soy un png').toString('base64')}`;
    const bad = await http.post(`/api/v1/documents/${payrollId}/sign`).set(as(worker, orgId)).send({ ...SIGNATURE, signature: notPng }).expect(400);
    expect(bad.body.code).toBe('INVALID_DOCUMENT');
  });

  it('firmar genera el PDF con el certificado y deja el sello de auditoría', async () => {
    const res = await http
      .post(`/api/v1/documents/${payrollId}/sign`)
      .set(as(worker, orgId))
      .set('User-Agent', 'NavegadorDePrueba/1.0')
      .send(SIGNATURE)
      .expect(200);
    expect(res.body.status).toBe('SIGNED');
    expect(res.body.audit).toMatchObject({
      signerName: 'obrero',
      signerDni: '12345678Z',
      userAgent: 'NavegadorDePrueba/1.0',
      originalSha256: createHash('sha256').update(pdf).digest('hex'),
      strokes: 3,
      points: 140,
    });
    expect(res.body.audit.ip).toBeTruthy();

    const signed = await binary(http.get(`/api/v1/documents/${payrollId}/content/signed`).set(as(boss, orgId))).expect(200);
    expect(signed.headers['content-disposition']).toContain('-firmado.pdf');
    expect(createHash('sha256').update(signed.body).digest('hex')).toBe(res.body.audit.signedSha256);
    const out = await PDFDocument.load(signed.body);
    expect(out.getPageCount()).toBe(3); // 2 originales + certificado
    expect(out.getSubject()).toContain('obrero (12345678Z)');
    // El original sigue disponible e intacto.
    const original = await binary(http.get(`/api/v1/documents/${payrollId}/content/original`).set(as(worker, orgId))).expect(200);
    expect(Buffer.compare(original.body, pdf)).toBe(0);
  });

  it('no se firma dos veces ni se retira un documento firmado', async () => {
    const again = await http.post(`/api/v1/documents/${payrollId}/sign`).set(as(worker, orgId)).send(SIGNATURE).expect(409);
    expect(again.body.code).toBe('ALREADY_SIGNED');
    await http.delete(`/api/v1/documents/${payrollId}`).set(as(boss, orgId)).expect(404);
  });

  it('seguimiento: el emisor ve el estado de cada destinatario y puede retirar lo no firmado', async () => {
    const sent = await http.get('/api/v1/documents/sent').set(as(boss, orgId)).expect(200);
    const safety = sent.body.filter((d: { title: string }) => d.title === 'Normas de seguridad');
    expect(Object.fromEntries(safety.map((d: { recipient: { fullName: string }; status: string }) => [d.recipient.fullName, d.status]))).toEqual({
      colega: 'SENT',
      encargado: 'SENT',
      obrero: 'VIEWED',
    });
    // El administrador ve todo lo enviado en la empresa, salvo la copia dirigida a él, que está en su bandeja.
    const leave = sent.body.filter((d: { title: string }) => d.title === 'Parte de baja');
    expect(leave.map((d: { recipient: { fullName: string } }) => d.recipient.fullName)).toEqual(['encargado']);
    expect((await http.get('/api/v1/documents/inbox').set(as(boss, orgId))).body.map((d: { title: string }) => d.title)).toEqual(['Parte de baja']);

    const mine = await http.get('/api/v1/documents/sent').set(as(worker, orgId)).expect(200);
    expect(mine.body).toHaveLength(2);
    const target = safety.find((d: { recipient: { fullName: string } }) => d.recipient.fullName === 'colega');
    await http.delete(`/api/v1/documents/${target.id}`).set(as(manager, orgId)).expect(404);
    await http.delete(`/api/v1/documents/${target.id}`).set(as(boss, orgId)).expect(204);
    expect((await http.get('/api/v1/documents/inbox').set(as(mate, orgId))).body).toEqual([]);
  });
});
