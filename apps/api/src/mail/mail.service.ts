import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { Deployment } from '../deployment/deployment';
import { Mailer, type MailMessage } from './mailer';
import type { Rendered } from './templates';

@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  /** URL pública de la web, sin barra final: base de los enlaces de los correos. */
  readonly appUrl: string;

  constructor(
    private readonly mailer: Mailer,
    private readonly deployment: Deployment,
    config: ConfigService<Env, true>,
  ) {
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
  }

  link(path: string): string {
    return `${this.appUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /**
   * Envía un correo. Nunca lanza: un fallo del proveedor no debe romper la acción
   * que lo origina. Devuelve si se entregó al proveedor.
   */
  async send(to: string, rendered: Rendered, tag: MailMessage['tag']): Promise<boolean> {
    // La demo pública no envía correo: no se puede usar para escribir a terceros desde nuestro dominio.
    if (this.deployment.isDemo) {
      this.log.log(`Correo «${tag}» no enviado: modo demo`);
      return false;
    }
    try {
      const { id } = await this.mailer.send({ to, tag, ...rendered });
      this.log.log(`Correo «${tag}» enviado${id ? ` (${id})` : ''}`);
      return true;
    } catch (e) {
      this.log.error(`No se pudo enviar el correo «${tag}»: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
}
