import { Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Etiqueta para agrupar envíos (p. ej. password_reset): en Resend es una etiqueta y en SMTP una cabecera. */
  tag: string;
}

export abstract class Mailer {
  /** Devuelve el identificador del envío en el proveedor. Lanza si el proveedor lo rechaza. */
  abstract send(message: MailMessage): Promise<{ id: string | null }>;
}

/** Envío real con la API HTTP de Resend (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendMailer extends Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo: string,
  ) {
    super();
  }

  async send(m: MailMessage): Promise<{ id: string | null }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
        tags: [{ name: 'type', value: m.tag }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) throw new Error(`Resend ${res.status}: ${body?.message ?? 'sin detalle'}`);
    return { id: body?.id ?? null };
  }
}

/** Envío por SMTP: el servidor de correo de la empresa, Gmail, Microsoft 365, el del hosting… */
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;

  constructor(
    options: { host: string; port: number; secure: boolean; requireTls: boolean; user: string; password: string },
    private readonly from: string,
    private readonly replyTo: string,
  ) {
    super();
    this.transport = createTransport({
      host: options.host,
      port: options.port,
      // secure: TLS desde el principio (465). Si no, se exige STARTTLS (587) salvo que se desactive a propósito.
      secure: options.secure,
      requireTLS: !options.secure && options.requireTls,
      auth: options.user ? { user: options.user, pass: options.password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(m: MailMessage): Promise<{ id: string | null }> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
      ...(this.replyTo ? { replyTo: this.replyTo } : {}),
      headers: { 'X-HR-Core-Type': m.tag },
    });
    return { id: info.messageId ?? null };
  }
}

/**
 * Para desarrollo y tests: no envía nada, lo deja en el log y en memoria.
 * Así se puede trabajar sin clave y los tests pueden leer el enlace del correo.
 */
export class LogMailer extends Mailer {
  private readonly log = new Logger('Correo');
  readonly outbox: MailMessage[] = [];

  /** Con `dir`, cada correo se guarda además como JSON: los tests de navegador leen ahí los enlaces. */
  constructor(private readonly dir = '') {
    super();
    if (dir) mkdirSync(dir, { recursive: true });
  }

  send(m: MailMessage): Promise<{ id: string | null }> {
    this.outbox.push(m);
    if (this.outbox.length > 200) this.outbox.shift();
    if (this.dir) writeFileSync(join(this.dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`), JSON.stringify(m));
    this.log.log(`[sin enviar] Para ${m.to} · ${m.subject}\n${m.text}`);
    return Promise.resolve({ id: null });
  }
}
