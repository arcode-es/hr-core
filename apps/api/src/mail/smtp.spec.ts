import { SMTPServer } from 'smtp-server';
import type { AddressInfo } from 'node:net';
import { SmtpMailer } from './mailer';

/** Un servidor SMTP de verdad, en memoria: comprueba lo que llega por el cable. */
describe('Correo por SMTP', () => {
  const received: { from: string; to: string[]; raw: string; user?: string }[] = [];
  let server: SMTPServer;
  let port: number;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onAuth: (auth, _session, cb) => (auth.username === 'hr' && auth.password === 'secreto' ? cb(null, { user: 'hr' }) : cb(new Error('credenciales'))),
      onData: (stream, session, cb) => {
        let raw = '';
        stream.on('data', (c: Buffer) => (raw += c.toString()));
        stream.on('end', () => {
          received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '', to: session.envelope.rcptTo.map((r) => r.address), raw, user: session.user as string | undefined });
          cb();
        });
      },
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const message = { to: 'ana@empresa.test', subject: 'Prueba de envío', html: '<p>Hola</p>', text: 'Hola', tag: 'prueba' };

  it('entrega el mensaje con remitente, respuesta, autenticación y la etiqueta en una cabecera', async () => {
    const mailer = new SmtpMailer({ host: '127.0.0.1', port, secure: false, requireTls: false, user: 'hr', password: 'secreto' }, 'HR-Core <no-reply@empresa.test>', 'rrhh@empresa.test');
    const { id } = await mailer.send(message);
    expect(id).toEqual(expect.any(String));
    const got = received.at(-1)!;
    expect(got).toMatchObject({ from: 'no-reply@empresa.test', to: ['ana@empresa.test'], user: 'hr' });
    // El asunto con tilde viaja codificado (RFC 2047), como debe.
    expect(got.raw).toMatch(/^Subject: =\?UTF-8\?Q\?Prueba_de_env=C3=ADo\?=/m);
    expect(got.raw).toMatch(/^Reply-To: rrhh@empresa\.test/m);
    expect(got.raw).toMatch(/^X-Hr-Core-Type: prueba/im);
  });

  it('por defecto no manda nada si el servidor no ofrece cifrado', async () => {
    const before = received.length;
    const mailer = new SmtpMailer({ host: '127.0.0.1', port, secure: false, requireTls: true, user: '', password: '' }, 'no-reply@empresa.test', '');
    await expect(mailer.send(message)).rejects.toThrow();
    expect(received).toHaveLength(before);
  });

  it('con credenciales erróneas falla en vez de dar el correo por enviado', async () => {
    const mailer = new SmtpMailer({ host: '127.0.0.1', port, secure: false, requireTls: false, user: 'hr', password: 'otra' }, 'no-reply@empresa.test', '');
    await expect(mailer.send(message)).rejects.toThrow();
  });
});
