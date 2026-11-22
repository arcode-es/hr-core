import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DeployMode } from '@hr/shared';
import type { Env } from '../config/env';

/**
 * Cómo está instalada la app y qué se permite en consecuencia. Todas las reglas
 * que dependen del modo pasan por aquí, para que no queden repartidas.
 */
@Injectable()
export class Deployment {
  readonly mode: DeployMode;
  /** Carpeta donde se publica (p. ej. /HR-core); vacía en la raíz del dominio. */
  readonly basePath: string;
  /** La cookie de sesión solo viaja a las rutas de /auth de la API. */
  readonly cookiePath: string;
  private readonly verification: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.mode = config.get('DEPLOY_MODE', { infer: true });
    this.basePath = config.get('BASE_PATH', { infer: true });
    this.cookiePath = `${this.basePath}/api/v1/auth`;
    this.verification = config.get('EMAIL_VERIFICATION', { infer: true }) === 'required';
  }

  get isDemo(): boolean {
    return this.mode === 'demo';
  }

  /** El espacio personal solo existe en instalaciones abiertas: en la demo y en un cliente hay una empresa. */
  get personalWorkspace(): boolean {
    return this.mode === 'open';
  }

  /** Registro libre: solo en modo open. En client hace falta invitación y en la demo no hay registro. */
  get openRegistration(): boolean {
    return this.mode === 'open';
  }

  /** Crear empresas desde la app: solo en modo open. En un cliente la crea el script de instalación. */
  get organizationCreation(): boolean {
    return this.mode === 'open';
  }

  /** Hay que confirmar el correo antes de crear empresas o invitar. */
  get emailVerificationRequired(): boolean {
    return this.mode === 'open' && this.verification;
  }

  /** En la demo no se cambian credenciales: lo que deja inservible la demo para el siguiente visitante. */
  assertNotDemo(): void {
    if (this.isDemo) throw new ForbiddenException({ code: 'DEMO_READ_ONLY' });
  }
}
