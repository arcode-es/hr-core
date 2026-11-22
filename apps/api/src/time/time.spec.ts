import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../app.module';
import { GeoService } from '../geo/geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { setupApp } from '../setup';

// JPEG mínimo válido (cabecera real) y un falso JPEG.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);
const NOT_AN_IMAGE = Buffer.from('<script>alert(1)</script>');

describe('Motor de fichaje', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const inside = { lat: 40.4169, lng: -3.7038, accuracy: 8 };
  const outside = { lat: 40.4208, lng: -3.7038, accuracy: 8 }; // ≈445 m del centro

  let boss: string;
  let worker: string;
  let other: string;
  let orgId: string;

  const as = (token: string, ws?: string) => ({ Authorization: `Bearer ${token}`, ...(ws ? { 'X-Workspace': ws } : {}) });
  const signUp = async (name: string): Promise<string> =>
    (await http.post('/api/v1/auth/register').send({ email: `${name}.${run}@time.dev`, password: 'secreto-1234', fullName: name }).expect(201))
      .body.accessToken;
  const event = (action: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ action, position: inside, clientTime: new Date().toISOString(), clientUuid: randomUUID(), ...extra });
  const clock = (token: string, ws: string | undefined, data: string) =>
    http.post('/api/v1/time/clock').set(as(token, ws)).field('data', data);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GeoService)
      .useValue({ reverse: async () => 'Puerta del Sol 1, 28013 Madrid', search: async () => [] })
      .compile();
    app = mod.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    boss = await signUp('jefa');
    worker = await signUp('obrero');
    other = await signUp('otro');
    orgId = (await http.post('/api/v1/organizations').set(as(boss)).send({ name: `Fichajes ${run}` }).expect(201)).body.organizationId;
    for (const [token, name] of [[worker, 'obrero'], [other, 'otro']] as const) {
      const inv = await http.post('/api/v1/invitations').set(as(boss, orgId)).send({ email: `${name}.${run}@time.dev` }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(as(token)).expect(200);
    }
    await http
      .post('/api/v1/locations')
      .set(as(boss, orgId))
      .send({ name: 'Obra Sol', latitude: 40.4168, longitude: -3.7038, geofenceRadiusMeters: 100 })
      .expect(201);
  });

  afterAll(() => app.close());

  it('sin jornada abierta el estado es IDLE y trae la hora del servidor', async () => {
    const res = await http.get('/api/v1/time/status').set(as(worker, orgId)).expect(200);
    expect(res.body.state).toBe('IDLE');
    expect(res.body.workday).toBeNull();
    expect(Math.abs(Date.parse(res.body.serverTime) - Date.now())).toBeLessThan(5000);
  });

  it('no permite pausar, reanudar ni finalizar sin haber iniciado', async () => {
    for (const data of [event('PAUSE', { pause: 'MEAL' }), event('RESUME'), event('STOP')]) {
      const res = await clock(worker, orgId, data).expect(409);
      expect(res.body.code).toBe('INVALID_CLOCK_STATE');
    }
    await clock(worker, orgId, event('PAUSE')).expect(400); // pausa sin motivo
  });

  it('inicia dentro del perímetro con la hora del servidor, no la del móvil', async () => {
    const res = await clock(worker, orgId, event('START', { clientTime: '2020-01-01T00:00:00.000Z' })).expect(200);
    expect(res.body.state).toBe('WORKING');
    const seg = res.body.workday.segments[0];
    expect(seg).toMatchObject({ entryType: 'WORK', origin: 'REALTIME', locationName: 'Obra Sol', isWithinGeofence: true, hasPosition: true });
    expect(Math.abs(Date.parse(seg.startTime) - Date.now())).toBeLessThan(5000);
    const row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: seg.id } });
    expect(row.clientStartTime?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });

  it('no permite iniciar dos veces, y reintentar el mismo evento no duplica', async () => {
    await clock(worker, orgId, event('START')).expect(409);
    const data = event('PAUSE', { pause: 'MEAL' });
    const first = await clock(worker, orgId, data).expect(200);
    const again = await clock(worker, orgId, data).expect(200);
    expect(again.body.workday.segments).toHaveLength(first.body.workday.segments.length);
    expect(again.body.state).toBe('PAUSED');
  });

  it('pausa de comida → reanudar → desplazamiento → reanudar: tramos encadenados sin huecos', async () => {
    await clock(worker, orgId, event('RESUME')).expect(200);
    await clock(worker, orgId, event('PAUSE', { pause: 'TRAVEL' })).expect(200);
    const res = await clock(worker, orgId, event('RESUME')).expect(200);
    const segs = res.body.workday.segments;
    expect(segs.map((s: { entryType: string }) => s.entryType)).toEqual(['WORK', 'BREAK', 'WORK', 'TRAVEL', 'WORK']);
    expect(segs[1].breakKind).toBe('MEAL');
    for (let i = 1; i < segs.length; i++) expect(segs[i].startTime).toBe(segs[i - 1].endTime);
    expect(segs[4].endTime).toBeNull();
  });

  it('la dirección postal se añade en segundo plano', async () => {
    await new Promise((r) => setTimeout(r, 300));
    const res = await http.get('/api/v1/time/status').set(as(worker, orgId)).expect(200);
    expect(res.body.workday.segments[0].startAddress).toBe('Puerta del Sol 1, 28013 Madrid');
  });

  it('el espacio personal lleva su propia jornada en paralelo', async () => {
    const personal = await clock(worker, undefined, event('START')).expect(200);
    expect(personal.body.workday.segments).toHaveLength(1);
    expect(personal.body.workday.segments[0].locationName).toBeNull(); // sin ubicaciones personales
    const company = await http.get('/api/v1/time/status').set(as(worker, orgId)).expect(200);
    expect(company.body.workday.segments).toHaveLength(5);
    await clock(worker, undefined, event('STOP')).expect(200);
  });

  it('finaliza con foto y la jornada queda cerrada', async () => {
    const res = await clock(worker, orgId, event('STOP')).attach('photo', JPEG, { filename: 'f.jpg', contentType: 'image/jpeg' }).expect(200);
    expect(res.body).toMatchObject({ state: 'IDLE', workday: null });
    const days = await http.get('/api/v1/time/workdays').set(as(worker, orgId)).expect(200);
    expect(days.body).toHaveLength(1);
    expect(days.body[0].endedAt).not.toBeNull();
    expect(days.body[0].segments[4].hasEndPhoto).toBe(true);
  });

  it('fuera del perímetro se admite y queda señalado con la distancia', async () => {
    const res = await clock(other, orgId, event('START', { position: outside }))
      .attach('photo', JPEG, { filename: 'f.jpg', contentType: 'image/jpeg' })
      .expect(200);
    const seg = res.body.workday.segments[0];
    expect(seg).toMatchObject({ locationName: 'Obra Sol', isWithinGeofence: false, hasStartPhoto: true });
    expect(seg.geofenceDistanceMeters).toBeGreaterThan(320);
    expect(seg.geofenceDistanceMeters).toBeLessThan(350);
    await clock(other, orgId, event('STOP', { position: null })).expect(200);
  });

  it('sin posición también se admite', async () => {
    const res = await clock(other, orgId, event('START', { position: null })).expect(200);
    expect(res.body.workday.segments[0]).toMatchObject({ hasPosition: false, isWithinGeofence: null, locationName: null });
    await clock(other, orgId, event('STOP', { position: null })).expect(200);
  });

  it('rechaza archivos que no son una imagen real', async () => {
    const res = await clock(other, orgId, event('START'))
      .attach('photo', NOT_AN_IMAGE, { filename: 'f.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(res.body.code).toBe('INVALID_PHOTO');
    expect((await http.get('/api/v1/time/status').set(as(other, orgId))).body.state).toBe('IDLE');
  });

  it('la foto solo se sirve con enlace firmado: al autor y a su responsable, no a un compañero', async () => {
    const days = await http.get('/api/v1/time/workdays').set(as(other, orgId)).expect(200);
    const seg = days.body[days.body.length - 1].segments[0];
    const mine = await http.get(`/api/v1/time/entries/${seg.id}/photo/start`).set(as(other, orgId)).expect(200);
    await http.get(`/api/v1/time/entries/${seg.id}/photo/start`).set(as(boss, orgId)).expect(200);
    await http.get(`/api/v1/time/entries/${seg.id}/photo/start`).set(as(worker, orgId)).expect(404);
    await http.get(`/api/v1/time/entries/${seg.id}/photo/end`).set(as(other, orgId)).expect(404);

    const path = new URL(mine.body.url);
    const file = await http.get(path.pathname + path.search).expect(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(file.body, JPEG)).toBe(0);
    // Sin firma, con firma alterada o caducada: denegado.
    await http.get(path.pathname).expect(403);
    await http.get(`${path.pathname}?exp=${path.searchParams.get('exp')}&sig=falsa`).expect(403);
    await http.get(`${path.pathname}?exp=1&sig=${path.searchParams.get('sig')}`).expect(403);
  });

  it('las jornadas de un usuario no las ve otro', async () => {
    const a = await http.get('/api/v1/time/workdays').set(as(worker, orgId)).expect(200);
    const b = await http.get('/api/v1/time/workdays').set(as(other, orgId)).expect(200);
    const ids = new Set(a.body.map((d: { id: string }) => d.id));
    expect(b.body.some((d: { id: string }) => ids.has(d.id))).toBe(false);
  });
});

describe('Fichaje sin conexión', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let token: string;
  const run = randomUUID().slice(0, 8);
  const as = () => ({ Authorization: `Bearer ${token}` });
  const send = (data: object) => http.post('/api/v1/time/clock').set(as()).field('data', JSON.stringify(data));
  const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
  const event = (action: string, minutesAgo: number, extra: Record<string, unknown> = {}) => ({
    action,
    position: { lat: 40.4168, lng: -3.7038, accuracy: 20 },
    clientTime: ago(minutesAgo),
    occurredAt: ago(minutesAgo),
    clientUuid: randomUUID(),
    ...extra,
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
    prisma = app.get(PrismaService);
    token = (await http.post('/api/v1/auth/register').send({ email: `offline.${run}@time.dev`, password: 'secreto-1234', fullName: 'Sin Cobertura' }).expect(201)).body.accessToken;
  });

  afterAll(() => app.close());

  it('una jornada entera registrada sin conexión se reproduce con sus horas reales', async () => {
    const queue = [event('START', 240), event('PAUSE', 120, { pause: 'MEAL' }), event('RESUME', 90), event('STOP', 10)];
    let last;
    for (const e of queue) last = await send(e).expect(200);
    expect(last!.body).toMatchObject({ state: 'IDLE', workday: null });

    const days = await http.get('/api/v1/time/workdays').set(as()).expect(200);
    const day = days.body[0];
    expect(day.segments.map((s: { entryType: string }) => s.entryType)).toEqual(['WORK', 'BREAK', 'WORK']);
    expect(day.segments.every((s: { syncedOffline: boolean; hasPosition: boolean }) => s.syncedOffline && s.hasPosition)).toBe(true);
    expect(day.startedAt).toBe(queue[0]!.occurredAt);
    expect(day.endedAt).toBe(queue[3]!.occurredAt);
    expect(day.workedSeconds).toBe((120 + 80) * 60);
    expect(day.breakSeconds).toBe(30 * 60);
    // La hora en que el servidor lo recibió queda aparte, para la trazabilidad.
    const row = await prisma.timeEntry.findUniqueOrThrow({ where: { id: day.segments[0].id } });
    expect(Date.now() - row.createdAt.getTime()).toBeLessThan(10_000);
    expect(row.startTime.toISOString()).toBe(queue[0]!.occurredAt);
  });

  it('reenviar cualquier evento, también pausar o finalizar, no lo aplica dos veces', async () => {
    // Después de la jornada anterior (que acabó hace 10 minutos): un evento sin conexión no puede solaparse con lo ya registrado.
    const start = event('START', 8);
    const stop = event('STOP', 5);
    await send(start).expect(200);
    await send(start).expect(200);
    await send(stop).expect(200);
    // El reintento de un STOP ya aplicado devuelve el estado actual en vez de fallar.
    const again = await send(stop).expect(200);
    expect(again.body.state).toBe('IDLE');
    const days = await http.get('/api/v1/time/workdays').set(as()).expect(200);
    expect(days.body).toHaveLength(2);
    expect(days.body[0].segments).toHaveLength(1);
  });

  it('no acepta horas imposibles: futuras, de hace más de una semana o anteriores al tramo abierto', async () => {
    const future = await send(event('START', -30)).expect(409);
    expect(future.body.code).toBe('OFFLINE_EVENT_REJECTED');
    await send(event('START', 60 * 24 * 8)).expect(409);
    await send(event('START', 3)).expect(200);
    const before = await send(event('STOP', 4)).expect(409);
    expect(before.body.code).toBe('OFFLINE_EVENT_REJECTED');
    await send(event('STOP', 1)).expect(200);
  });

  it('un evento que ya no encaja con el estado se rechaza sin romper nada', async () => {
    const res = await send(event('RESUME', 0)).expect(409);
    expect(res.body.code).toBe('INVALID_CLOCK_STATE');
    expect((await http.get('/api/v1/time/status').set(as())).body.state).toBe('IDLE');
  });

  it('un gasto reenviado desde la cola no se duplica', async () => {
    const data = JSON.stringify({ category: 'MEAL', amount: 12, date: '2026-03-10', paymentMethod: 'EMPLOYEE_PAID', clientUuid: randomUUID() });
    const first = await http.post('/api/v1/expenses').set(as()).field('data', data).expect(201);
    const second = await http.post('/api/v1/expenses').set(as()).field('data', data).expect(201);
    expect(second.body.id).toBe(first.body.id);
    const list = await http.get('/api/v1/expenses').query({ from: '2026-03-01', to: '2026-03-31' }).set(as()).expect(200);
    expect(list.body).toHaveLength(1);
  });
});
