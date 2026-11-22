import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_NAME, AppMeta, LegalInfo } from '@hr/shared';
import { Public } from '../common/context';
import type { Env } from '../config/env';
import { DEMO_ACCOUNTS, DEMO_KIOSK_PIN } from '../demo/accounts';
import { Deployment } from '../deployment/deployment';

/** La pone la imagen publicada (APP_VERSION, desde la etiqueta de la versión); en desarrollo, package.json. */
const VERSION = process.env.APP_VERSION || process.env.npm_package_version || 'dev';

/** Lo que la web necesita saber de la instalación antes de que nadie entre. */
@Public()
@Controller('meta')
export class MetaController {
  private readonly demoPassword: string;
  private readonly legal: LegalInfo | null;

  constructor(
    private readonly deployment: Deployment,
    config: ConfigService<Env, true>,
  ) {
    this.demoPassword = config.get('DEMO_PASSWORD', { infer: true });
    const name = config.get('LEGAL_NAME', { infer: true });
    this.legal = name
      ? {
          name,
          taxId: config.get('LEGAL_TAX_ID', { infer: true }),
          address: config.get('LEGAL_ADDRESS', { infer: true }),
          email: config.get('LEGAL_EMAIL', { infer: true }),
          provider: config.get('LEGAL_PROVIDER', { infer: true }),
          subprocessors: config.get('LEGAL_SUBPROCESSORS', { infer: true }),
        }
      : null;
  }

  @Get()
  meta(): AppMeta {
    return {
      mode: this.deployment.mode,
      appName: APP_NAME,
      version: VERSION,
      // En la demo las claves son públicas: se muestran en la pantalla de acceso.
      demo: this.deployment.isDemo ? { password: this.demoPassword, kioskPin: DEMO_KIOSK_PIN, accounts: DEMO_ACCOUNTS } : null,
      legal: this.legal,
    };
  }
}
