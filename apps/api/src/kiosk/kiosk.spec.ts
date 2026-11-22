import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp } from '../testing/boot';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 5), Buffer.from([0xff, 0xd9])]);

describe('Quiosco de fichaje', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let boss: string;
  let worker: string;
  let workerId: string;
  let workerMembership: string;
  let orgId: string;
  let locationId: string;
  let device: string;
  const as = (token: string) => ({ ...bearer(token), 'X-Workspace': orgId });
  const kiosk = (token = device) => ({ 'X-Kiosk-Token': token });
  const signUp = async (name: string) => {
    const email = `${name}.${run}@kiosk.dev`;
    const res = await http.post('/api/v1/auth/register').send({ email, password: 'secreto-1234', fullName: `${name} Quiosco` }).expect(201);
    return { token: res.body.accessToken as string, email };
  };
  const kclock = (identity: string, action: string, extra: Record<string, unknown> = {}) =>
    http
      .post('/api/v1/kiosk/clock')
      .set(kiosk())
      .field('data', JSON.stringify({ token: identity, action, clientTime: new Date().toISOString(), clientUuid: randomUUID(), ...extra }));

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    prisma = app.get(PrismaService);
    boss = (await signUp('jefa')).token;
    orgId = (await http.post('/api/v1/organizations').set(bearer(boss)).send({ name: `Quiosco ${run}` }).expect(201)).body.organizationId;
    const w = await signUp('obrera');
    worker = w.token;
    const inv = await http.post('/api/v1/invitations').set(as(boss)).send({ email: w.email }).expect(201);
    await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(worker)).expect(200);
    workerId = (await http.get('/api/v1/me').set(bearer(worker))).body.user.id;
    workerMembership = (await prisma.membership.findFirstOrThrow({ where: { userId: workerId, organizationId: orgId } })).id;
    locationId = (await http.post('/api/v1/locations').set(as(boss)).send({ name: 'Nave Quiosco', address: 'Polígono 3, Paterna', latitude: 39.5, longitude: -0.44, geofenceRadiusMeters: 100 }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('solo la administración crea quioscos; el código empareja una vez y caduca', async () => {
    await http.post('/api/v1/kiosks').set(as(worker)).send({ name: 'Tablet' }).expect(403);
    const created = (await http.post('/api/v1/kiosks').set(as(boss)).send({ name: 'Tablet entrada', locationId }).expect(201)).body;
    expect(created.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(created.kiosk).toMatchObject({ name: 'Tablet entrada', paired: false, location: { id: locationId, name: 'Nave Quiosco' } });

    await http.post('/api/v1/kiosk/pair').send({ code: 'ZZZZZZZZ' }).expect(401);
    const paired = (await http.post('/api/v1/kiosk/pair').send({ code: created.code.toLowerCase() }).expect(200)).body;
    device = paired.token;
    expect(paired.info).toMatchObject({ name: 'Tablet entrada', locationName: 'Nave Quiosco', requirePhoto: false });
    expect(paired.info.people.map((p: { fullName: string }) => p.fullName)).toEqual(['jefa Quiosco', 'obrera Quiosco']);
    await http.post('/api/v1/kiosk/pair').send({ code: created.code }).expect(401); // un solo uso

    // Un código caducado no sirve.
    const second = (await http.post('/api/v1/kiosks').set(as(boss)).send({ name: 'Tablet almacén' }).expect(201)).body;
    await prisma.kioskDevice.update({ where: { id: second.kiosk.id }, data: { pairingExpiresAt: new Date(Date.now() - 1000) } });
    await http.post('/api/v1/kiosk/pair').send({ code: second.code }).expect(401);

    const list = (await http.get('/api/v1/kiosks').set(as(boss)).expect(200)).body;
    expect(list.find((k: { id: string }) => k.id === created.kiosk.id)).toMatchObject({ paired: true });
    await http.get('/api/v1/kiosk/info').expect(401);
    await http.get('/api/v1/kiosk/info').set(kiosk()).expect(200);
  });

  it('PIN: cada persona elige el suyo; tras 5 fallos se bloquea', async () => {
    await http.post('/api/v1/kiosk/identify').set(kiosk()).send({ membershipId: workerMembership, pin: '1234' }).expect(409).expect((r) => expect(r.body.code).toBe('PIN_NOT_SET'));
    expect((await http.get('/api/v1/me/kiosk-pin').set(as(worker)).expect(200)).body).toEqual({ set: false });
    await http.put('/api/v1/me/kiosk-pin').set(as(worker)).send({ pin: '12a4' }).expect(400);
    await http.put('/api/v1/me/kiosk-pin').set(as(worker)).send({ pin: '4826' }).expect(204);
    expect((await http.get('/api/v1/me/kiosk-pin').set(as(worker)).expect(200)).body).toEqual({ set: true });
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: workerMembership } });
    expect(m.kioskPinHash).not.toContain('4826');

    for (let i = 0; i < 4; i++) await http.post('/api/v1/kiosk/identify').set(kiosk()).send({ membershipId: workerMembership, pin: '0000' }).expect(401);
    await http.post('/api/v1/kiosk/identify').set(kiosk()).send({ membershipId: workerMembership, pin: '0000' }).expect(403).expect((r) => expect(r.body.code).toBe('PIN_LOCKED'));
    await http.post('/api/v1/kiosk/identify').set(kiosk()).send({ membershipId: workerMembership, pin: '4826' }).expect(403); // bloqueado aunque acierte
    await prisma.membership.update({ where: { id: workerMembership }, data: { kioskLockedUntil: null } });
  });

  it('ficha con la ubicación del quiosco como presencia, foto incluida, sin repetir eventos', async () => {
    const id = (await http.post('/api/v1/kiosk/identify').set(kiosk()).send({ membershipId: workerMembership, pin: '4826' }).expect(200)).body;
    expect(id).toMatchObject({ fullName: 'obrera Quiosco', state: 'IDLE' });

    const uuid = randomUUID();
    const send = () =>
      http
        .post('/api/v1/kiosk/clock')
        .set(kiosk())
        .field('data', JSON.stringify({ token: id.token, action: 'START', clientTime: new Date().toISOString(), clientUuid: uuid }))
        .attach('photo', JPEG, { filename: 'k.jpg', contentType: 'image/jpeg' });
    expect((await send().expect(200)).body).toMatchObject({ state: 'WORKING', fullName: 'obrera Quiosco' });
    await send().expect(200); // reintento: no se aplica dos veces
    const entries = await prisma.timeEntry.findMany({ where: { userId: workerId, organizationId: orgId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ presenceMethod: 'KIOSK', isWithinGeofence: true, startAddress: 'Polígono 3, Paterna', locationId });
    expect(entries[0]!.startPhotoKey).toBeTruthy();

    await kclock(id.token, 'STOP').expect(200);
    // Lo ve en su app como cualquier otro fichaje.
    const days = (await http.get('/api/v1/time/workdays?days=1').set(as(worker)).expect(200)).body;
    expect(days[0].segments[0].presenceMethod).toBe('KIOSK');
  });

  it('la identificación no sirve en otro quiosco ni como sesión, y una tablet revocada deja de funcionar', async () => {
    const id = (await http.post('/api/v1/kiosk/identify').set(kiosk()).send({ membershipId: workerMembership, pin: '4826' }).expect(200)).body;
    await http.get('/api/v1/me').set(bearer(id.token)).expect(401);

    const other = (await http.post('/api/v1/kiosks').set(as(boss)).send({ name: 'Otra' }).expect(201)).body;
    const otherDevice = (await http.post('/api/v1/kiosk/pair').send({ code: other.code }).expect(200)).body.token;
    await http
      .post('/api/v1/kiosk/clock')
      .set(kiosk(otherDevice))
      .field('data', JSON.stringify({ token: id.token, action: 'START', clientTime: new Date().toISOString(), clientUuid: randomUUID() }))
      .expect(401);

    await http.delete(`/api/v1/kiosks/${other.kiosk.id}`).set(as(boss)).expect(204);
    await http.get('/api/v1/kiosk/info').set(kiosk(otherDevice)).expect(401);
  });

  it('tarjeta personal: identifica con el código y el PIN; la administración puede borrar el PIN', async () => {
    const pdf = await http.get(`/api/v1/members/${workerMembership}/kiosk-card.pdf`).set(as(boss)).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const { kioskCardCode } = await prisma.membership.findUniqueOrThrow({ where: { id: workerMembership } });
    expect(kioskCardCode).toBeTruthy();
    await http.post('/api/v1/kiosk/identify').set(kiosk()).send({ cardCode: kioskCardCode, pin: '4826' }).expect(200);
    await http.get(`/api/v1/members/${workerMembership}/kiosk-card.pdf`).set(as(worker)).expect(403);

    await http.delete(`/api/v1/members/${workerMembership}/kiosk-pin`).set(as(boss)).expect(204);
    await http.post('/api/v1/kiosk/identify').set(kiosk()).send({ cardCode: kioskCardCode, pin: '4826' }).expect(409);
  });
});
