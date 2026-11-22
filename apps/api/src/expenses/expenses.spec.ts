import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { GeoService } from '../geo/geo.service';
import { OcrProvider } from '../ocr/ocr.provider';
import { setupApp } from '../setup';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7), Buffer.from([0xff, 0xd9])]);

describe('Gastos y tickets', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const run = randomUUID().slice(0, 8);
  const range = { from: '2026-03-01', to: '2026-03-31' };

  let boss: string;
  let manager: string;
  let worker: string;
  let mate: string;
  let orgId: string;
  let workerId: string;

  const as = (token: string, ws?: string) => ({ Authorization: `Bearer ${token}`, ...(ws ? { 'X-Workspace': ws } : {}) });
  const signUp = async (name: string): Promise<string> =>
    (await http.post('/api/v1/auth/register').send({ email: `${name}.${run}@exp.dev`, password: 'secreto-1234', fullName: name }).expect(201))
      .body.accessToken;
  const expense = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ category: 'MEAL', amount: 14.5, date: '2026-03-10', paymentMethod: 'EMPLOYEE_PAID', merchantName: 'Bar Pepe', ...extra });
  const create = (token: string, ws: string | undefined, data: string) => http.post('/api/v1/expenses').set(as(token, ws)).field('data', data);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GeoService)
      .useValue({ reverse: async () => null, search: async () => [] })
      .overrideProvider(OcrProvider)
      .useValue({
        name: 'test',
        extract: async () => ({ provider: 'test', amount: 23.9, taxAmount: 2.17, date: '2026-03-09', merchantName: 'Gasolinera Sol', merchantTaxId: 'B12345678' }),
      })
      .compile();
    app = mod.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());

    boss = await signUp('jefa');
    manager = await signUp('encargado');
    worker = await signUp('obrero');
    mate = await signUp('colega');
    orgId = (await http.post('/api/v1/organizations').set(as(boss)).send({ name: `Gastos ${run}` }).expect(201)).body.organizationId;
    for (const [token, name, role] of [[manager, 'encargado', 'MANAGER'], [worker, 'obrero', 'EMPLOYEE'], [mate, 'colega', 'EMPLOYEE']] as const) {
      const inv = await http.post('/api/v1/invitations').set(as(boss, orgId)).send({ email: `${name}.${run}@exp.dev`, role }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(as(token)).expect(200);
    }
    workerId = (await http.get('/api/v1/me').set(as(worker))).body.user.id;
  });

  afterAll(() => app.close());

  it('valida importe, IVA y fecha', async () => {
    await create(worker, orgId, expense({ amount: 0 })).expect(400);
    await create(worker, orgId, expense({ amount: 10.999 })).expect(400);
    await create(worker, orgId, expense({ taxAmount: 20 })).expect(400);
    await create(worker, orgId, expense({ date: '10/03/2026' })).expect(400);
    const future = await create(worker, orgId, expense({ date: '2099-01-01' })).expect(400);
    expect(future.body.code).toBe('INVALID_RANGE');
    await create(worker, orgId, 'no es json').expect(400);
  });

  let mealId: string;

  it('el gasto de un empleado nace pendiente, con su ticket', async () => {
    const res = await create(worker, orgId, expense({ taxAmount: 1.32, notes: 'Comida en ruta' }))
      .attach('receipt', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' })
      .expect(201);
    mealId = res.body.id;
    expect(res.body).toMatchObject({ status: 'PENDING', amount: 14.5, taxAmount: 1.32, currency: 'EUR', hasReceipt: true, merchantName: 'Bar Pepe', date: '2026-03-10' });
  });

  it('rechaza un ticket que no es una imagen', async () => {
    const res = await create(worker, orgId, expense()).attach('receipt', Buffer.from('%PDF-1.4 falso'), { filename: 't.jpg', contentType: 'image/jpeg' }).expect(400);
    expect(res.body.code).toBe('INVALID_PHOTO');
  });

  it('el kilometraje lo calcula el servidor con la tarifa de la empresa', async () => {
    const res = await create(worker, orgId, expense({ category: 'MILEAGE', amount: 9999, distanceKm: 120, paymentMethod: 'COMPANY_CARD', merchantName: null })).expect(201);
    expect(res.body).toMatchObject({ category: 'MILEAGE', amount: 31.2, distanceKm: 120, paymentMethod: 'EMPLOYEE_PAID', taxAmount: null });
    await create(worker, orgId, expense({ category: 'MILEAGE', amount: 10 })).expect(400); // sin kilómetros
  });

  it('en el espacio personal y para el administrador queda aprobado directamente', async () => {
    expect((await create(worker, undefined, expense()).expect(201)).body.status).toBe('APPROVED');
    expect((await create(boss, orgId, expense({ paymentMethod: 'COMPANY_CARD', amount: 80, category: 'MATERIAL' })).expect(201)).body.status).toBe('APPROVED');
    expect((await create(manager, orgId, expense({ amount: 22 })).expect(201)).body.status).toBe('PENDING');
  });

  it('cada uno ve solo sus gastos; el ticket, su autor y quien supervisa', async () => {
    const mine = await http.get('/api/v1/expenses').query(range).set(as(worker, orgId)).expect(200);
    expect(mine.body).toHaveLength(2);
    expect((await http.get('/api/v1/expenses').query(range).set(as(mate, orgId)).expect(200)).body).toEqual([]);
    const url = await http.get(`/api/v1/expenses/${mealId}/receipt`).set(as(worker, orgId)).expect(200);
    await http.get(`/api/v1/expenses/${mealId}/receipt`).set(as(manager, orgId)).expect(200);
    await http.get(`/api/v1/expenses/${mealId}/receipt`).set(as(mate, orgId)).expect(404);
    const path = new URL(url.body.url);
    const file = await http.get(path.pathname + path.search).expect(200);
    expect(Buffer.compare(file.body, JPEG)).toBe(0);
  });

  it('la bandeja es solo para quien aprueba, y nadie aprueba lo suyo', async () => {
    await http.get('/api/v1/expenses/pending').set(as(worker, orgId)).expect(403);
    const list = await http.get('/api/v1/expenses/pending').set(as(manager, orgId)).expect(200);
    expect(list.body).toHaveLength(3);
    const own = list.body.find((e: { user: { fullName: string } }) => e.user.fullName === 'encargado');
    await http.post(`/api/v1/expenses/${own.id}/review`).set(as(manager, orgId)).send({ decision: 'APPROVE' }).expect(404);
    await http.post(`/api/v1/expenses/${mealId}/review`).set(as(worker, orgId)).send({ decision: 'APPROVE' }).expect(403);
  });

  it('rechazar exige motivo; el empleado corrige y se reenvía', async () => {
    await http.post(`/api/v1/expenses/${mealId}/review`).set(as(manager, orgId)).send({ decision: 'REJECT' }).expect(400);
    const rej = await http.post(`/api/v1/expenses/${mealId}/review`).set(as(manager, orgId)).send({ decision: 'REJECT', reason: 'Falta el nombre del cliente' }).expect(200);
    expect(rej.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Falta el nombre del cliente', reviewedBy: 'encargado' });
    const fixed = await http
      .patch(`/api/v1/expenses/${mealId}`)
      .set(as(worker, orgId))
      .field('data', expense({ taxAmount: 1.32, notes: 'Comida con cliente: Obras Ruiz' }))
      .expect(200);
    expect(fixed.body).toMatchObject({ status: 'PENDING', rejectionReason: null, hasReceipt: true, notes: 'Comida con cliente: Obras Ruiz' });
  });

  it('aprobado ya no se edita ni se borra; pendiente sí se puede borrar', async () => {
    await http.post(`/api/v1/expenses/${mealId}/review`).set(as(manager, orgId)).send({ decision: 'APPROVE' }).expect(200);
    await http.post(`/api/v1/expenses/${mealId}/review`).set(as(boss, orgId)).send({ decision: 'REJECT', reason: 'demasiado tarde' }).expect(404);
    const locked = await http.patch(`/api/v1/expenses/${mealId}`).set(as(worker, orgId)).field('data', expense({ amount: 500 })).expect(409);
    expect(locked.body.code).toBe('EXPENSE_LOCKED');
    await http.delete(`/api/v1/expenses/${mealId}`).set(as(worker, orgId)).expect(409);

    const extra = await create(worker, orgId, expense({ amount: 3 })).expect(201);
    await http.delete(`/api/v1/expenses/${extra.body.id}`).set(as(mate, orgId)).expect(404);
    await http.delete(`/api/v1/expenses/${extra.body.id}`).set(as(worker, orgId)).expect(204);
  });

  it('liquidación: separa pendiente, a reembolsar y tarjeta de empresa', async () => {
    const mine = await http.get('/api/v1/expenses/summary').query(range).set(as(worker, orgId)).expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ count: 2, pending: 31.2, toReimburse: 14.5, reimbursed: 0 })]);

    const team = await http.get('/api/v1/expenses/summary').query(range).set(as(boss, orgId)).expect(200);
    const byName = Object.fromEntries(team.body.map((r: { user: { fullName: string } }) => [r.user.fullName, r]));
    expect(byName.jefa).toMatchObject({ companyCard: 80, toReimburse: 0 });
    expect(byName.encargado).toMatchObject({ pending: 22 });
    expect(byName.obrero).toMatchObject({ toReimburse: 14.5 });
  });

  it('marcar como pagado liquida solo lo aprobado y adelantado', async () => {
    await http.post('/api/v1/expenses/reimburse').set(as(worker, orgId)).send({ userId: workerId, ...range }).expect(403);
    const res = await http.post('/api/v1/expenses/reimburse').set(as(boss, orgId)).send({ userId: workerId, ...range }).expect(200);
    expect(res.body).toEqual({ reimbursed: 1, amount: 14.5 });
    const after = await http.get('/api/v1/expenses/summary').query(range).set(as(worker, orgId)).expect(200);
    expect(after.body[0]).toMatchObject({ toReimburse: 0, reimbursed: 14.5, pending: 31.2 });
    const list = await http.get('/api/v1/expenses').query(range).set(as(worker, orgId)).expect(200);
    expect(list.body.find((e: { id: string }) => e.id === mealId)).toMatchObject({ status: 'REIMBURSED' });
    expect((await http.post('/api/v1/expenses/reimburse').set(as(boss, orgId)).send({ userId: workerId, ...range }).expect(200)).body.reimbursed).toBe(0);
  });

  it('categorías propias: las crea quien gestiona y heredan su categoría base', async () => {
    await http.post('/api/v1/expenses/categories').set(as(worker, orgId)).send({ name: 'EPIs' }).expect(403);
    const cat = await http.post('/api/v1/expenses/categories').set(as(boss, orgId)).send({ name: 'EPIs', baseCategory: 'MATERIAL' }).expect(201);
    await http.post('/api/v1/expenses/categories').set(as(boss, orgId)).send({ name: 'EPIs' }).expect(409);
    const cfg = await http.get('/api/v1/expenses/config').set(as(worker, orgId)).expect(200);
    expect(cfg.body).toMatchObject({ currency: 'EUR', mileageRatePerKm: 0.26, customCategories: [{ name: 'EPIs', baseCategory: 'MATERIAL' }] });

    const res = await create(worker, orgId, expense({ category: 'OTHER', customCategoryId: cat.body.id, amount: 45 })).expect(201);
    expect(res.body).toMatchObject({ category: 'MATERIAL', customCategoryName: 'EPIs' });
    // En el espacio personal no existen las categorías de la empresa.
    await create(worker, undefined, expense({ customCategoryId: cat.body.id })).expect(404);
  });

  it('el OCR devuelve la propuesta del proveedor y no acepta archivos que no son imagen', async () => {
    const res = await http.post('/api/v1/expenses/ocr').set(as(worker, orgId)).attach('receipt', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' }).expect(200);
    expect(res.body).toMatchObject({ provider: 'test', amount: 23.9, merchantName: 'Gasolinera Sol', date: '2026-03-09' });
    await http.post('/api/v1/expenses/ocr').set(as(worker, orgId)).attach('receipt', Buffer.from('nada'), { filename: 't.jpg', contentType: 'image/jpeg' }).expect(400);
    await http.post('/api/v1/expenses/ocr').set(as(worker, orgId)).expect(400);
  });
});
