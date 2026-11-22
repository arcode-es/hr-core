import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../app.module';
import { GeoService } from '../geo/geo.service';
import { setupApp } from '../setup';
import { csv } from './format';

// JPEG 1×1 real, para que el anexo de fotos pueda incrustarlo.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

describe('Informes', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const run = randomUUID().slice(0, 8);
  const month = '2026-03';

  let boss: string;
  let worker: string;
  let mate: string;
  let orgId: string;
  let workerId: string;

  const as = (token: string, ws?: string) => ({ Authorization: `Bearer ${token}`, ...(ws ? { 'X-Workspace': ws } : {}) });
  const email = (name: string): string => `${name.toLowerCase().replace(/[^a-z]+/g, '')}.${run}@rep.dev`;
  const signUp = async (name: string): Promise<string> =>
    (await http.post('/api/v1/auth/register').send({ email: email(name), password: 'secreto-1234', fullName: name }).expect(201)).body.accessToken;
  const madrid = (day: number, hhmm: string): string => new Date(Date.parse(`2026-03-${String(day).padStart(2, '0')}T${hhmm}:00Z`) - 3600_000).toISOString();
  const binary = (req: request.Test) =>
    req.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  const report = (path: string, token: string, query: Record<string, string>, ws: string | undefined = orgId) =>
    binary(http.get(`/api/v1/reports/${path}`).query({ month, ...query }).set(as(token, ws)));

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GeoService)
      .useValue({ reverse: async () => null, search: async () => [] })
      .compile();
    app = mod.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());

    boss = await signUp('Marta Ruiz');
    worker = await signUp('Luis Peña Soler');
    mate = await signUp('colega');
    orgId = (await http.post('/api/v1/organizations').set(as(boss)).send({ name: `Reformas Ortega ${run}`, taxId: 'B12345678' }).expect(201)).body.organizationId;
    for (const [token, name] of [[worker, 'Luis Peña Soler'], [mate, 'colega']] as const) {
      const inv = await http.post('/api/v1/invitations').set(as(boss, orgId)).send({ email: email(name) }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(as(token)).expect(200);
    }
    workerId = (await http.get('/api/v1/me').set(as(worker))).body.user.id;
    await http.patch('/api/v1/me').set(as(worker)).send({ dniNie: '12345678Z' }).expect(200);

    // Cuadrante publicado y jornadas de dos semanas, con una jornada larga y una nocturna.
    const days = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13];
    await http
      .post('/api/v1/shifts')
      .set(as(boss, orgId))
      .send({ shifts: days.map((d) => ({ userId: workerId, start: madrid(d, '08:00'), end: madrid(d, '16:30'), breakMinutes: 30 })) })
      .expect(201);
    await http.post('/api/v1/shifts/publish').set(as(boss, orgId)).send({ from: madrid(1, '00:00'), to: madrid(31, '00:00') }).expect(200);
    const manual = (b: object) => http.post('/api/v1/time/manual').set(as(boss, orgId)).send({ userId: workerId, reason: 'Carga inicial de prueba', breaks: [], ...b }).expect(201);
    for (const d of days) {
      await manual({
        start: madrid(d, '08:00'),
        end: madrid(d, d === 5 ? '19:00' : '16:30'),
        breaks: [{ kind: 'MEAL', start: madrid(d, '13:00'), end: madrid(d, '13:30') }, ...(d === 10 ? [{ kind: 'TRAVEL', start: madrid(d, '10:00'), end: madrid(d, '10:45') }] : [])],
      });
    }
    await manual({ start: madrid(14, '21:00'), end: madrid(14, '23:30') });
    // Una jornada pendiente: no debe salir en el registro oficial.
    await http.post('/api/v1/time/manual').set(as(worker, orgId)).send({ start: madrid(16, '08:00'), end: madrid(16, '12:00'), breaks: [], reason: 'Pendiente de validar' }).expect(201);

    const expense = (data: object, withReceipt: boolean) => {
      const req = http.post('/api/v1/expenses').set(as(worker, orgId)).field('data', JSON.stringify({ paymentMethod: 'EMPLOYEE_PAID', ...data }));
      return (withReceipt ? req.attach('receipt', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' }) : req).expect(201);
    };
    const meal = await expense({ category: 'MEAL', amount: 23.9, taxAmount: 2.17, date: '2026-03-10', merchantName: 'Bar Pepe', notes: 'Comida con cliente' }, true);
    await expense({ category: 'MILEAGE', distanceKm: 120, date: '2026-03-10', notes: 'Valencia – Sagunto – Valencia' }, false);
    const fuel = await expense({ category: 'FUEL', amount: 60, date: '2026-03-12', merchantName: '=HYPERLINK("http://x")', paymentMethod: 'COMPANY_CARD' }, true);
    await http.post(`/api/v1/expenses/${meal.body.id}/review`).set(as(boss, orgId)).send({ decision: 'APPROVE' }).expect(200);
    await http.post(`/api/v1/expenses/${fuel.body.id}/review`).set(as(boss, orgId)).send({ decision: 'REJECT', reason: 'Falta la matrícula' }).expect(200);
  });

  afterAll(() => app.close());

  it('valida el mes y el formato', async () => {
    await http.get('/api/v1/reports/timesheet').query({ month: '2026-13' }).set(as(worker, orgId)).expect(400);
    await http.get('/api/v1/reports/timesheet').query({ month, format: 'docx' }).set(as(worker, orgId)).expect(400);
    await http.get('/api/v1/reports/timesheet').query({ month }).expect(401);
  });

  it('registro de jornada en PDF: una página, con nombre de archivo y metadatos', async () => {
    const res = await report('timesheet', worker, {}).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="registro-jornada-2026-03-luis-pena-soler.pdf"');
    if (process.env.REPORT_SAMPLES_DIR) writeFileSync(`${process.env.REPORT_SAMPLES_DIR}/registro-jornada.pdf`, res.body);
    const pdf = await PDFDocument.load(res.body);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain('Registro de jornada 2026-03');
  });

  it('registro en Excel: 31 días, totales con fórmula y solo jornadas aprobadas', async () => {
    const res = await report('timesheet', worker, { format: 'xlsx' }).expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.worksheets[0]!;
    const rows: unknown[][] = [];
    ws.eachRow((r) => rows.push(r.values as unknown[]));
    const header = rows.findIndex((r) => r[1] === 'Fecha');
    const days = rows.slice(header + 1, header + 32);
    expect(days).toHaveLength(31);
    const row = (day: number) => days[day - 1] as unknown[];
    // Lunes 2: 08:00–16:30 con 30 min de pausa → 8 h, todas ordinarias.
    expect(row(2).slice(2, 10)).toEqual(['08:00–13:00 · 13:30–16:30', 0.5, 0, 8, 0, 0, 8, 8]);
    // Viernes 5: hasta las 19:00 → 10,5 h, 2,5 extra.
    expect(row(5).slice(5, 9)).toEqual([8, 2.5, 0, 10.5]);
    // Martes 10: 45 min de desplazamiento aparte.
    expect(row(10)[4]).toBe(0.75);
    // Sábado 14, sin turno: todo extra, 1,5 h nocturnas.
    expect(row(14).slice(5, 9)).toEqual([0, 2.5, 1.5, 2.5]);
    // Lunes 16: la jornada pendiente no computa.
    expect(row(16)[8]).toBe(0);
    expect((rows[header + 32]![8] as { formula: string }).formula).toMatch(/^SUM\(H\d+:H\d+\)$/);
  });

  it('registro en CSV: un tramo por línea, abre bien en Excel en español', async () => {
    const res = await report('timesheet', worker, { format: 'csv' }).expect(200);
    const text = res.body.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Fecha;Tipo;Inicio;Fin;Horas');
    expect(text).toContain('02/03/2026;Trabajo;08:00:00;13:00:00;5;Manual');
    expect(text).toContain('Pausa (comida)');
    expect(text).toContain('Desplazamiento');
  });

  it('informe detallado: apaisado, con cada tramo', async () => {
    const res = await report('timesheet-detail', worker, {}).expect(200);
    const pdf = await PDFDocument.load(res.body);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
    if (process.env.REPORT_SAMPLES_DIR) writeFileSync(`${process.env.REPORT_SAMPLES_DIR}/jornada-detallada.pdf`, res.body);
  });

  it('liquidación de gastos en PDF con anexo de tickets, Excel y CSV', async () => {
    const pdfRes = await report('expenses', worker, {}).expect(200);
    expect(pdfRes.headers['content-disposition']).toContain('liquidacion-gastos-2026-03-luis-pena-soler.pdf');
    expect((await PDFDocument.load(pdfRes.body)).getPageCount()).toBe(2); // tabla + anexo
    if (process.env.REPORT_SAMPLES_DIR) writeFileSync(`${process.env.REPORT_SAMPLES_DIR}/liquidacion-gastos.pdf`, pdfRes.body);

    const xlsx = await report('expenses', worker, { format: 'xlsx' }).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    const values: unknown[][] = [];
    wb.worksheets[0]!.eachRow((r) => values.push(r.values as unknown[]));
    const find = (label: string) => values.find((r) => r[1] === label)?.[12];
    expect(find('Pendiente de reembolso')).toBe(23.9);
    expect(find('Pendiente de aprobación')).toBe(31.2);
    expect(find('Rechazado')).toBe(60);
    expect(find('Total sin rechazados')).toBe(55.1);

    const text = (await report('expenses', worker, { format: 'csv' }).expect(200)).body.toString('utf8');
    expect(text).toContain('Bar Pepe');
    expect(text).toContain(';23,9;EUR;Sí;Comida con cliente');
    expect(text).toContain('Falta la matrícula');
    // Una celda que empieza por «=» se neutraliza para que Excel no la ejecute.
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('cada uno saca lo suyo; lo de otra persona, solo quien supervisa', async () => {
    await report('timesheet', mate, { userId: workerId }).expect(403);
    await report('expenses', mate, { userId: workerId }).expect(403);
    const res = await report('timesheet', boss, { userId: workerId, format: 'csv' }).expect(200);
    expect(res.body.toString('utf8')).toContain('Luis Peña Soler');
    await report('timesheet', boss, { userId: randomUUID() }).expect(404);
    // El espacio personal del trabajador no contiene los datos de la empresa.
    const personal = await report('timesheet', worker, { format: 'csv' }, '').expect(200);
    expect(personal.body.toString('utf8')).not.toContain('02/03/2026');
    expect(personal.body.toString('utf8')).toContain('Registro personal');
  });
});

describe('csv', () => {
  it('escapa separadores, comillas y saltos de línea, y usa coma decimal', () => {
    expect(csv([['a;b', 'dijo "hola"', 'dos\nlíneas', 1.5]]).toString('utf8')).toBe('﻿"a;b";"dijo ""hola""";"dos\nlíneas";1,5\r\n');
  });
  it('el PDF conserva los saltos de línea de una celda en vez de sustituirlos', async () => {
    const { PdfReport } = await import('./pdf-kit');
    const doc = await PdfReport.create({ title: 't', footer: 'f' });
    expect(doc.wrap('39.4699, -0.3763 (±15 m)\nPlaza del Ayuntamiento 21', doc.font, 8, 400)).toEqual(['39.4699, -0.3763 (±15 m)', 'Plaza del Ayuntamiento 21']);
  });
  it('neutraliza las celdas que empezarían una fórmula', () => {
    expect(csv([['=1+1', '+34 600', '-5', '@cmd', 'normal']]).toString('utf8')).toContain(`'=1+1;'+34 600;'-5;'@cmd;normal`);
  });
});
