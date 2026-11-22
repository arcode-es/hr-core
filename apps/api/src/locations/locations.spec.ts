import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { setupApp } from '../setup';

/** Integración contra PostGIS real. */
describe('Ubicaciones y geocercas', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const run = randomUUID().slice(0, 8);
  // Puerta del Sol, Madrid. 0,001° de latitud ≈ 111 m.
  const sol = { name: 'Obra Sol', latitude: 40.4168, longitude: -3.7038, geofenceRadiusMeters: 200 };

  let boss: string;
  let worker: string;
  let orgId: string;
  let solId: string;

  const as = (token: string, ws?: string) => {
    const h: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (ws) h['X-Workspace'] = ws;
    return h;
  };
  const signUp = async (name: string): Promise<string> => {
    const res = await http
      .post('/api/v1/auth/register')
      .send({ email: `${name}.${run}@loc.dev`, password: 'secreto-1234', fullName: name })
      .expect(201);
    return res.body.accessToken;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());

    boss = await signUp('jefa');
    worker = await signUp('obrero');
    const org = await http.post('/api/v1/organizations').set(as(boss)).send({ name: `Obras ${run}` }).expect(201);
    orgId = org.body.organizationId;
    const inv = await http.post('/api/v1/invitations').set(as(boss, orgId)).send({ email: `obrero.${run}@loc.dev` }).expect(201);
    await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(as(worker)).expect(200);
  });

  afterAll(() => app.close());

  it('valida coordenadas y radio', async () => {
    await http.post('/api/v1/locations').set(as(boss, orgId)).send({ ...sol, latitude: 120 }).expect(400);
    await http.post('/api/v1/locations').set(as(boss, orgId)).send({ ...sol, geofenceRadiusMeters: 5 }).expect(400);
  });

  it('el responsable crea ubicaciones de empresa; el empleado no', async () => {
    const res = await http.post('/api/v1/locations').set(as(boss, orgId)).send(sol).expect(201);
    solId = res.body.id;
    expect(res.body).toMatchObject({ name: 'Obra Sol', isActive: true, personal: false });
    const denied = await http.post('/api/v1/locations').set(as(worker, orgId)).send(sol).expect(403);
    expect(denied.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('las ubicaciones personales y las de empresa no se mezclan', async () => {
    const mine = await http.post('/api/v1/locations').set(as(worker)).send({ ...sol, name: 'Mi casa' }).expect(201);
    expect(mine.body.personal).toBe(true);

    const personal = await http.get('/api/v1/locations').set(as(worker)).expect(200);
    expect(personal.body.map((l: { name: string }) => l.name)).toEqual(['Mi casa']);
    const company = await http.get('/api/v1/locations').set(as(worker, orgId)).expect(200);
    expect(company.body.map((l: { name: string }) => l.name)).toEqual(['Obra Sol']);
    // La jefa no ve ni puede tocar la ubicación personal del empleado.
    const bossPersonal = await http.get('/api/v1/locations').set(as(boss)).expect(200);
    expect(bossPersonal.body).toEqual([]);
    await http.patch(`/api/v1/locations/${mine.body.id}`).set(as(boss, orgId)).send({ name: 'x2' }).expect(404);
  });

  it('detecta dentro del perímetro (≈111 m del centro, radio 200)', async () => {
    const res = await http.get('/api/v1/locations/near').query({ lat: 40.4178, lng: -3.7038 }).set(as(worker, orgId)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].location.id).toBe(solId);
    expect(res.body[0].distanceMeters).toBeGreaterThan(105);
    expect(res.body[0].distanceMeters).toBeLessThan(117);
    expect(res.body[0]).toMatchObject({ within: true, outsideByMeters: 0 });
  });

  it('fuera del perímetro indica a cuántos metros (≈333 m del centro)', async () => {
    const res = await http.get('/api/v1/locations/near').query({ lat: 40.4198, lng: -3.7038 }).set(as(worker, orgId)).expect(200);
    expect(res.body[0].within).toBe(false);
    expect(res.body[0].outsideByMeters).toBeGreaterThan(125);
    expect(res.body[0].outsideByMeters).toBeLessThan(140);
  });

  it('la imprecisión del GPS se concede, con límite', async () => {
    // ≈222 m del centro: 22 m fuera, pero con 30 m de precisión cuenta como dentro.
    const near = await http
      .get('/api/v1/locations/near')
      .query({ lat: 40.4188, lng: -3.7038, accuracy: 30 })
      .set(as(worker, orgId))
      .expect(200);
    expect(near.body[0].within).toBe(true);
    const far = await http
      .get('/api/v1/locations/near')
      .query({ lat: 40.4198, lng: -3.7038, accuracy: 900 })
      .set(as(worker, orgId))
      .expect(200);
    expect(far.body[0].within).toBe(false);
  });

  it('ordena por cercanía', async () => {
    await http
      .post('/api/v1/locations')
      .set(as(boss, orgId))
      .send({ name: 'Almacén', latitude: 40.45, longitude: -3.69, geofenceRadiusMeters: 100 })
      .expect(201);
    const res = await http.get('/api/v1/locations/near').query({ lat: 40.4495, lng: -3.69 }).set(as(worker, orgId)).expect(200);
    expect(res.body.map((m: { location: { name: string } }) => m.location.name)).toEqual(['Almacén', 'Obra Sol']);
  });

  it('una ubicación desactivada deja de contar y el empleado no la ve', async () => {
    await http.patch(`/api/v1/locations/${solId}`).set(as(boss, orgId)).send({ isActive: false }).expect(200);
    const near = await http.get('/api/v1/locations/near').query({ lat: 40.4168, lng: -3.7038 }).set(as(worker, orgId)).expect(200);
    expect(near.body.map((m: { location: { name: string } }) => m.location.name)).toEqual(['Almacén']);
    const employee = await http.get('/api/v1/locations').set(as(worker, orgId)).expect(200);
    expect(employee.body).toHaveLength(1);
    const manager = await http.get('/api/v1/locations').set(as(boss, orgId)).expect(200);
    expect(manager.body).toHaveLength(2);
  });

  it('mover el punto recalcula la geometría', async () => {
    await http
      .patch(`/api/v1/locations/${solId}`)
      .set(as(boss, orgId))
      .send({ isActive: true, latitude: 41.3874, longitude: 2.1686 })
      .expect(200);
    const res = await http.get('/api/v1/locations/near').query({ lat: 41.3874, lng: 2.1686 }).set(as(worker, orgId)).expect(200);
    expect(res.body[0]).toMatchObject({ distanceMeters: 0, within: true });
    expect(res.body[0].location.name).toBe('Obra Sol');
  });
});
