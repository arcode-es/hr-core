import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { GeoService } from '../geo/geo.service';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp } from '../testing/boot';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3), Buffer.from([0xff, 0xd9])]);

describe('Fichaje ampliado: QR, foto obligatoria y puntualidad', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const geo = { reverse: jest.fn(async () => 'Calle Nominatim 1'), search: async () => [] };
  const run = randomUUID().slice(0, 8);
  let boss: string;
  let worker: string;
  let workerId: string;
  let orgId: string;
  let locationId: string;
  let settings: Record<string, unknown>;
  const inside = { lat: 39.4699, lng: -0.3763, accuracy: 10 };
  const as = (token: string) => ({ ...bearer(token), 'X-Workspace': orgId });
  const event = (action: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ action, position: null, clientTime: new Date().toISOString(), clientUuid: randomUUID(), ...extra });
  const clock = (token: string, data: string) => http.post('/api/v1/time/clock').set(as(token)).field('data', data);
  const signUp = async (name: string) => {
    const email = `${name}.${run}@clock.dev`;
    const res = await http.post('/api/v1/auth/register').send({ email, password: 'secreto-1234', fullName: `${name} Fichaje` }).expect(201);
    return { token: res.body.accessToken as string, email };
  };
  const patchSettings = async (extra: Record<string, unknown>) => {
    await http.patch('/api/v1/organization').set(as(boss)).send({ ...settings, ...extra }).expect(200);
  };
  const lastSegment = async () => (await http.get('/api/v1/time/workdays?days=1').set(as(worker)).expect(200)).body[0];

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }, (b) => b.overrideProvider(GeoService).useValue(geo)));
    prisma = app.get(PrismaService);
    boss = (await signUp('jefa')).token;
    orgId = (await http.post('/api/v1/organizations').set(bearer(boss)).send({ name: `QR ${run}` }).expect(201)).body.organizationId;
    const w = await signUp('obrero');
    worker = w.token;
    const inv = await http.post('/api/v1/invitations').set(as(boss)).send({ email: w.email }).expect(201);
    await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(worker)).expect(200);
    workerId = (await http.get('/api/v1/me').set(bearer(worker))).body.user.id;
    locationId = (
      await http.post('/api/v1/locations').set(as(boss)).send({ name: 'Obra Ruzafa', address: 'Calle Sueca 1, Valencia', latitude: 39.4699, longitude: -0.3763, geofenceRadiusMeters: 150 }).expect(201)
    ).body.id;
    const { id: _i, currency: _c, ...dto } = (await http.get('/api/v1/organization').set(as(boss))).body;
    settings = dto;
  });
  afterAll(() => app.close());

  it('el QR de la ubicación cuenta como presencia; uno copiado o regenerado se rechaza', async () => {
    await http.post(`/api/v1/locations/${locationId}/qr`).set(as(worker)).expect(403);
    const { code } = (await http.post(`/api/v1/locations/${locationId}/qr`).set(as(boss)).expect(201)).body;
    expect(code).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const pdf = await http.get(`/api/v1/locations/${locationId}/qr.pdf`).set(as(boss)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await clock(worker, event('START', { qr: { locationId, code: 'x'.repeat(24) } })).expect(400).expect((r) => expect(r.body.code).toBe('QR_INVALID'));
    geo.reverse.mockClear();
    const res = await clock(worker, event('START', { qr: { locationId, code } })).expect(200);
    expect(res.body.state).toBe('WORKING');
    const seg = (await lastSegment()).segments[0];
    expect(seg).toMatchObject({ presenceMethod: 'QR', isWithinGeofence: true, startAddress: 'Calle Sueca 1, Valencia' });
    expect(geo.reverse).not.toHaveBeenCalled(); // la dirección es la de la ubicación: no se consulta fuera
    await clock(worker, event('STOP', { qr: { locationId, code } })).expect(200);

    // Regenerar invalida el cartel anterior.
    const fresh = (await http.post(`/api/v1/locations/${locationId}/qr`).set(as(boss)).expect(201)).body.code;
    expect(fresh).not.toBe(code);
    await clock(worker, event('START', { qr: { locationId, code } })).expect(400);
  });

  it('con GPS dentro de una ubicación conocida usa su dirección y marca presencia GPS', async () => {
    geo.reverse.mockClear();
    await clock(worker, event('START', { position: inside })).expect(200);
    await clock(worker, event('STOP', { position: inside })).expect(200);
    const seg = (await lastSegment()).segments[0];
    expect(seg).toMatchObject({ presenceMethod: 'GPS', startAddress: 'Calle Sueca 1, Valencia' });
    expect(geo.reverse).not.toHaveBeenCalled();
  });

  it('foto obligatoria: sin foto se rechaza salvo que se declare que no se pudo hacer', async () => {
    await patchSettings({ requirePhotoOnClock: true });
    expect((await http.get('/api/v1/time/status').set(as(worker)).expect(200)).body.requirePhoto).toBe(true);
    await clock(worker, event('START')).expect(400).expect((r) => expect(r.body.code).toBe('PHOTO_REQUIRED'));
    await clock(worker, event('START')).attach('photo', JPEG, { filename: 'f.jpg', contentType: 'image/jpeg' }).expect(200);
    await clock(worker, event('PAUSE', { pause: 'REST' })).expect(200); // las pausas no piden foto
    await clock(worker, event('RESUME')).expect(200);
    await clock(worker, event('STOP', { photoUnavailable: true })).expect(200);
    const day = await lastSegment();
    const work = day.segments.filter((s: { entryType: string }) => s.entryType === 'WORK');
    expect(work.at(-1).photoMissing).toBe(true);
    expect(work[0].photoMissing).toBe(false);
    await patchSettings({ requirePhotoOnClock: false });
  });

  it('puntualidad: guarda los minutos de retraso sobre el turno pasada la tolerancia', async () => {
    await patchSettings({ lateToleranceMinutes: 10 });
    const start = new Date(Date.now() - 25 * 60_000);
    const end = new Date(Date.now() + 5 * 3_600_000);
    await http.post('/api/v1/shifts').set(as(boss)).send({ shifts: [{ userId: workerId, start: start.toISOString(), end: end.toISOString(), locationId }] }).expect(201);
    await http.post('/api/v1/shifts/publish').set(as(boss)).send({ from: new Date(start.getTime() - 60_000).toISOString(), to: end.toISOString() }).expect(200);
    await clock(worker, event('START', { position: inside })).expect(200);
    const day = await lastSegment();
    expect(day.lateMinutes).toBeGreaterThanOrEqual(25);
    expect(day.lateMinutes).toBeLessThan(28);
    await clock(worker, event('STOP', { position: inside })).expect(200);
    const row = await prisma.timeEntry.findFirst({ where: { userId: workerId, lateMinutes: { not: null } } });
    expect(row?.lateMinutes).toBe(day.lateMinutes);
  });
});
