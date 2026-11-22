import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { LogMailer, Mailer, ResendMailer, SmtpMailer } from './mailer';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Mailer => {
        const from = config.get('EMAIL_FROM', { infer: true });
        const replyTo = config.get('EMAIL_REPLY_TO', { infer: true });
        const driver = config.get('EMAIL_DRIVER', { infer: true });
        if (driver === 'resend') {
          const key = config.get('RESEND_API_KEY', { infer: true });
          if (!key) throw new Error('EMAIL_DRIVER=resend necesita RESEND_API_KEY');
          return new ResendMailer(key, from, replyTo);
        }
        if (driver === 'smtp') {
          const host = config.get('SMTP_HOST', { infer: true });
          if (!host) throw new Error('EMAIL_DRIVER=smtp necesita SMTP_HOST');
          const port = config.get('SMTP_PORT', { infer: true });
          return new SmtpMailer(
            { host, port, secure: config.get('SMTP_SECURE', { infer: true }) ?? port === 465, requireTls: config.get('SMTP_REQUIRE_TLS', { infer: true }), user: config.get('SMTP_USER', { infer: true }), password: config.get('SMTP_PASSWORD', { infer: true }) },
            from,
            replyTo,
          );
        }
        new Logger('Correo').warn('EMAIL_DRIVER=log: los correos no se envían, solo se escriben en el log.');
        return new LogMailer(config.get('EMAIL_LOG_DIR', { infer: true }));
      },
    },
    MailService,
  ],
  exports: [MailService, Mailer],
})
export class MailModule {}
