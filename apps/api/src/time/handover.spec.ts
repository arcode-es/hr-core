import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { bearer, bootApp } from '../testing/boot';

describe('Notas de relevo', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = randomUUID().slice(0, 8);
  let orgId: string;
  const people: Record<string, { token: string; id: string }> = {};
  const as = (name: string) => ({ ...bearer(people[name]!.token), 'X-Workspace': orgId });
  const event = (action: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ action, position: null, clientTime: new Date().toISOString(), clientUuid: randomUUID(), ...extra });
  const clock = (name: string, action: string, extra: Record<string, unknown> = {}) =>
    http.post('/api/v1/time/clock').set(as(name)).field('data', event(action, extra));
  const signUp = async (name: string) => {
    const email = `${name}.${run}@relevo.dev`;
    const res = await http.post('/api/v1/auth/register').send({ email, password: 'secreto-1234', fullName: `${name} Relevo` }).expect(201);
    const id = (await http.get('/api/v1/me').set(bearer(res.body.accessToken))).body.user.id as string;
    people[name] = { token: res.body.accessToken, id };
    return email;
  };

  beforeAll(async () => {
    ({ app, http } = await bootApp({ DEPLOY_MODE: 'open', AUTH_RATE_LIMIT_PER_MINUTE: '1000' }));
    prisma = app.get(PrismaService);
    await signUp('jefa');
    orgId = (await http.post('/api/v1/organizations').set(bearer(people.jefa!.token)).send({ name: `Relevo ${run}` }).expect(201)).body.organizationId;
    for (const name of ['manana', 'tarde', 'noche']) {
      const email = await signUp(name);
      const inv = await http.post('/api/v1/invitations').set(as('jefa')).send({ email }).expect(201);
      await http.post(`/api/v1/invite/${inv.body.token}/accept`).set(bearer(people[name]!.token)).expect(200);
    }
  });
  afterAll(() => app.close());

  it('la nota para el siguiente turno la recibe la primera persona que empieza, y solo ella', async () => {
    await clock('manana', 'START').expect(200);
    // Solo se admite al terminar.
    await clock('manana', 'PAUSE', { pause: 'REST', note: { text: 'no vale', recipientId: null } }).expect(400);
    await clock('manana', 'STOP', { note: { text: '  Queda la zanja abierta en el patio.  ', recipientId: null } }).expect(200);

    // Quien la escribe no se la entrega a sí mismo al volver a fichar.
    const own = await clock('manana', 'START').expect(200);
    expect(own.body.notes).toEqual([]);
    await clock('manana', 'STOP').expect(200);

    const first = await clock('tarde', 'START').expect(200);
    expect(first.body.notes).toHaveLength(1);
    expect(first.body.notes[0]).toMatchObject({ text: 'Queda la zanja abierta en el patio.', direct: false, author: { id: people.manana!.id, fullName: 'manana Relevo' } });
    const second = await clock('noche', 'START').expect(200);
    expect(second.body.notes).toEqual([]);

    // Sigue a la vista hasta que se marca como leída; otra persona no puede marcarla.
    const noteId = first.body.notes[0].id as string;
    expect((await http.get('/api/v1/time/status').set(as('tarde')).expect(200)).body.notes).toHaveLength(1);
    await http.post(`/api/v1/time/notes/${noteId}/read`).set(as('noche')).expect(404);
    const read = await http.post(`/api/v1/time/notes/${noteId}/read`).set(as('tarde')).expect(200);
    expect(read.body.notes).toEqual([]);

    const sent = (await http.get('/api/v1/time/notes/sent').set(as('manana')).expect(200)).body;
    expect(sent[0]).toMatchObject({ text: 'Queda la zanja abierta en el patio.', recipient: null, deliveredTo: { id: people.tarde!.id } });
    expect(sent[0].readAt).not.toBeNull();
    await clock('tarde', 'STOP').expect(200);
    await clock('noche', 'STOP').expect(200);
  });

  it('la nota dirigida a alguien espera a esa persona aunque otros empiecen antes', async () => {
    const colleagues = (await http.get('/api/v1/time/colleagues').set(as('manana')).expect(200)).body as { id: string }[];
    expect(colleagues.map((c) => c.id).sort()).toEqual([people.jefa!.id, people.tarde!.id, people.noche!.id].sort());

    await clock('manana', 'START').expect(200);
    await clock('manana', 'STOP', { note: { text: 'Para ti, noche', recipientId: randomUUID() } }).expect(400).expect((r) => expect(r.body.code).toBe('HANDOVER_RECIPIENT_INVALID'));
    await clock('manana', 'STOP', { note: { text: 'Para ti, noche', recipientId: people.noche!.id } }).expect(200);

    expect((await clock('tarde', 'START').expect(200)).body.notes).toEqual([]);
    const res = await clock('noche', 'START').expect(200);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0]).toMatchObject({ text: 'Para ti, noche', direct: true });
    await clock('tarde', 'STOP').expect(200);
    await clock('noche', 'STOP').expect(200);
  });

  it('una nota para el siguiente turno caduca; en el espacio personal no se admite', async () => {
    await clock('manana', 'START').expect(200);
    await clock('manana', 'STOP', { note: { text: 'Vieja', recipientId: null } }).expect(200);
    await prisma.handoverNote.updateMany({ where: { organizationId: orgId, body: 'Vieja' }, data: { createdAt: new Date(Date.now() - 80 * 3_600_000) } });
    expect((await clock('tarde', 'START').expect(200)).body.notes).toEqual([]);
    await clock('tarde', 'STOP').expect(200);

    const solo = bearer(people.tarde!.token);
    await http.post('/api/v1/time/clock').set(solo).field('data', event('START')).expect(200);
    await http.post('/api/v1/time/clock').set(solo).field('data', event('STOP', { note: { text: 'x', recipientId: null } })).expect(400);
    await http.post('/api/v1/time/clock').set(solo).field('data', event('STOP')).expect(200);
  });
});
