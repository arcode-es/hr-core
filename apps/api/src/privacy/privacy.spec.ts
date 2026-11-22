import type { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { jpeg, RECEIPT_MEAL, SITE_A } from '../demo/images';
import { isQuiet } from '../notifications/notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { Storage } from '../storage/storage';
import { bearer, bootApp } from '../testing/boot';
import { PrivacyService } from './privacy.service';

const QUIET = { enabled: true, start: '20:00', end: '08:00', weekends: true };

describe('Horario de desconexión (cálculo)', () => {
  // 2030-01-15 es martes; en enero Madrid va una hora por delante de UTC.
  const at = (iso: string): Date => new Date(iso);
  it('aplica el tramo que cruza la medianoche, en hora local', () => {
    expect(isQuiet(QUIET, 'Europe/Madrid', at('2030-01-15T18:59:00Z'))).toBe(false); // 19:59
    expect(isQuiet(QUIET, 'Europe/Madrid', at('2030-01-15T19:00:00Z'))).toBe(true); // 20:00
    expect(isQuiet(QUIET, 'Europe/Madrid', at('2030-01-16T06:59:00Z'))).toBe(true); // 07:59
    expect(isQuiet(QUIET, 'Europe/Madrid', at('2030-01-16T07:00:00Z'))).toBe(false); // 08:00
  });
  it('los fines de semana, todo el día; y nada si está desactivado', () => {
    expect(isQuiet(QUIET, 'Europe/Madrid', at('2030-01-19T11:00:00Z'))).toBe(true); // sábado 12:00
    expect(isQuiet({ ...QUIET, weekends: false }, 'Europe/Madrid', at('2030-01-19T11:00:00Z'))).toBe(false);
    expect(isQuiet({ ...QUIET, enabled: false }, 'Europe/Madrid', at('2030-01-15T22:00:00Z'))).toBe(false);
  });
});

describe('Privacidad', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  const pw = 'secreto-1234';
  let bossToken: string;
  let workerToken: string;
  let orgId: string;

  const signUp = async (name: string): Promise<{ token: string; email: string }> => {
    const email = `${name.toLowerCase()}.${run}@test.dev`;
    const res = await http.post('/api/v1/auth/register').send({ email, password: pw, fullName: `${name} Pruebas` }).expect(201);
    return { token: res.body.accessToken as string, email };
  };

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    prisma = app.get(PrismaService);
    bossToken = (await signUp('Jefa')).token;
    orgId = (await http.post('/api/v1/organizations').set(bearer(bossToken)).send({ name: `Privacidad ${run}` }).expect(201)).body.organizationId;
    const worker = await signUp('Obrero');
    workerToken = worker.token;
    const inv = await http.post('/api/v1/invitations').set(bearer(bossToken)).set('X-Workspace', orgId).send({ email: worker.email, role: 'EMPLOYEE' }).expect(201);
    await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(workerToken)).expect(200);
  });
  afterAll(() => app.close());

  it('el aviso de geolocalización se pide una vez por empresa, y no en el espacio personal', async () => {
    const before = await http.get('/api/v1/time/geo-notice').set(bearer(workerToken)).set('X-Workspace', orgId).expect(200);
    expect(before.body).toMatchObject({ required: true, accepted: false, organizationName: `Privacidad ${run}`, photoRetentionMonths: 12 });
    const ws = (await http.get('/api/v1/me').set(bearer(workerToken))).body.workspaces.find((w: { kind: string }) => w.kind === 'organization');
    expect(ws.geoNoticeAccepted).toBe(false);
    await http.post('/api/v1/time/geo-notice').set(bearer(workerToken)).set('X-Workspace', orgId).expect(204);
    expect((await http.get('/api/v1/time/geo-notice').set(bearer(workerToken)).set('X-Workspace', orgId)).body.accepted).toBe(true);
    const after = (await http.get('/api/v1/me').set(bearer(workerToken))).body.workspaces.find((w: { kind: string }) => w.kind === 'organization');
    expect(after.geoNoticeAccepted).toBe(true);
    expect((await http.get('/api/v1/time/geo-notice').set(bearer(workerToken))).body).toMatchObject({ required: false });
  });

  it('la empresa guarda sus ajustes de privacidad y un cliente que no los envía no los borra', async () => {
    const current = (await http.get('/api/v1/organization').set(bearer(bossToken)).set('X-Workspace', orgId).expect(200)).body;
    const { id: _id, currency: _currency, ...dto } = current;
    await http
      .patch('/api/v1/organization')
      .set(bearer(bossToken))
      .set('X-Workspace', orgId)
      .send({ ...dto, photoRetentionMonths: 6, quietHours: QUIET, geoNoticeText: 'Solo RR. HH. ve las ubicaciones.' })
      .expect(200);
    const { photoRetentionMonths: _p, quietHours: _q, geoNoticeText: _g, ...legacy } = dto;
    const kept = await http.patch('/api/v1/organization').set(bearer(bossToken)).set('X-Workspace', orgId).send({ ...legacy, name: `Privacidad ${run}` }).expect(200);
    expect(kept.body).toMatchObject({ photoRetentionMonths: 6, quietHours: QUIET, geoNoticeText: 'Solo RR. HH. ve las ubicaciones.' });
    const notice = await http.get('/api/v1/time/geo-notice').set(bearer(workerToken)).set('X-Workspace', orgId).expect(200);
    expect(notice.body).toMatchObject({ companyText: 'Solo RR. HH. ve las ubicaciones.', photoRetentionMonths: 6 });
  });

  it('exporta todos los datos de la persona en un ZIP, con sus fotos y tickets', async () => {
    const clock = (action: string) =>
      http
        .post('/api/v1/time/clock')
        .set(bearer(workerToken))
        .set('X-Workspace', orgId)
        .field('data', JSON.stringify({ action, position: { lat: 39.47, lng: -0.37, accuracy: 10 }, clientTime: new Date().toISOString(), clientUuid: randomUUID() }))
        .attach('photo', jpeg(SITE_A), 'foto.jpg')
        .expect(200);
    await clock('START');
    await clock('STOP');
    await http
      .post('/api/v1/expenses')
      .set(bearer(workerToken))
      .set('X-Workspace', orgId)
      .field('data', JSON.stringify({ category: 'MEAL', amount: 12.5, date: new Date().toISOString().slice(0, 10) }))
      .attach('receipt', jpeg(RECEIPT_MEAL), 'ticket.jpg')
      .expect(201);

    const res = await http
      .get('/api/v1/me/export')
      .set(bearer(workerToken))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.get('Content-Type')).toBe('application/zip');
    expect(res.get('Content-Disposition')).toMatch(/mis-datos-hr-core-\d{4}-\d{2}-\d{2}\.zip/);
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const data = JSON.parse(await zip.file('datos.json')!.async('string'));
    expect(data.perfil.correo).toBe(`obrero.${run}@test.dev`);
    expect(data.empresas[0]).toMatchObject({ empresa: `Privacidad ${run}`, rol: 'EMPLOYEE' });
    expect(data.fichajes.length).toBeGreaterThanOrEqual(1);
    expect(data.gastos).toHaveLength(1);
    const files = Object.keys(zip.files);
    expect(files.some((f) => f.startsWith('tickets/'))).toBe(true);
    expect(files.filter((f) => f.startsWith('fotos-fichaje/')).length).toBeGreaterThanOrEqual(2);
  });

  it('borra las fotos que superan el plazo de la empresa y conserva el fichaje', async () => {
    const storage = app.get(Storage);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `obrero.${run}@test.dev` } });
    const key = `time/${user.id}/2020/01/${randomUUID()}-start.jpg`;
    await storage.put(key, jpeg(SITE_A), 'image/jpeg');
    const old = await prisma.timeEntry.create({
      data: { organizationId: orgId, userId: user.id, workdayId: randomUUID(), startTime: new Date('2020-01-10T08:00:00Z'), endTime: new Date('2020-01-10T15:00:00Z'), startPhotoKey: key },
    });
    await app.get(PrivacyService).purgeExpiredPhotos(new Date());
    const after = await prisma.timeEntry.findUniqueOrThrow({ where: { id: old.id } });
    expect(after.startPhotoKey).toBeNull();
    expect(after.photosPurgedAt).not.toBeNull();
    expect(after.endTime).toEqual(old.endTime);
    await expect(storage.get(key)).rejects.toThrow();
  });

  it('retiene el push durante la desconexión y lo suelta al terminar', async () => {
    const notifications = app.get(NotificationsService);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `obrero.${run}@test.dev` } });
    const n = await prisma.notification.create({ data: { userId: user.id, organizationId: orgId, type: 'SHIFT_UPDATED', payload: { link: '/schedule' }, pushedAt: null } });
    // Un instante en desconexión y otro fuera, dentro de las 24 h en que el push sigue retenido.
    const hours = Array.from({ length: 23 }, (_, i) => new Date(n.createdAt.getTime() + (i + 1) * 3_600_000));
    const quiet = hours.find((h) => isQuiet(QUIET, 'Europe/Madrid', h))!;
    const awake = hours.find((h) => h > quiet && !isQuiet(QUIET, 'Europe/Madrid', h));
    await notifications.releaseHeld(quiet);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).pushedAt).toBeNull();
    if (!awake) return; // de viernes a domingo no hay ninguna hora fuera de la desconexión en 24 h
    await notifications.releaseHeld(awake);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).pushedAt).not.toBeNull();
  });

  it('la baja de una cuenta que trabajó en una empresa conserva nombre y DNI, y cierra el acceso', async () => {
    const { id } = await prisma.user.findUniqueOrThrow({ where: { email: `obrero.${run}@test.dev` } });
    await http.post('/api/v1/me/delete').set(bearer(workerToken)).send({ password: 'mala' }).expect(401);
    await http.patch('/api/v1/me').set(bearer(workerToken)).send({ dniNie: '12345678Z', phone: '600000000' }).expect(200);
    await http.post('/api/v1/me/delete').set(bearer(workerToken)).send({ password: pw }).expect(204);
    await http.post('/api/v1/auth/login').send({ email: `obrero.${run}@test.dev`, password: pw }).expect(401);
    const gone = await prisma.user.findUniqueOrThrow({ where: { id }, include: { memberships: true } });
    expect(gone).toMatchObject({ fullName: 'Obrero Pruebas', dniNie: '12345678Z', active: false, phone: null });
    expect(gone.email).toMatch(/@baja\.invalid$/);
    expect(gone.memberships.every((m) => !m.active)).toBe(true);
    // Los fichajes siguen en la empresa.
    expect(await prisma.timeEntry.count({ where: { userId: gone.id, organizationId: orgId } })).toBeGreaterThan(0);
  });

  it('la baja de una cuenta solo personal borra sus datos identificativos y sus gastos', async () => {
    const solo = await signUp('Solita');
    await http.patch('/api/v1/me').set(bearer(solo.token)).send({ dniNie: '87654321X' }).expect(200);
    await http
      .post('/api/v1/expenses')
      .set(bearer(solo.token))
      .field('data', JSON.stringify({ category: 'MEAL', amount: 9, date: new Date().toISOString().slice(0, 10) }))
      .attach('receipt', jpeg(RECEIPT_MEAL), 'ticket.jpg')
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: solo.email } });
    await http.post('/api/v1/me/delete').set(bearer(solo.token)).send({ password: pw }).expect(204);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ fullName: 'Cuenta eliminada', dniNie: null, active: false });
    expect(after.email).toMatch(/@baja\.invalid$/);
    expect(await prisma.expense.count({ where: { userId: user.id } })).toBe(0);
  });
});
