import { Injectable } from '@nestjs/common';
import { DEFAULT_ORGANIZATION_SETTINGS } from '@hr/shared';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { hashToken } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { welcomeAdminEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';

/** Días que vale el enlace para que el primer administrador elija su contraseña. */
const SETUP_DAYS = 7;

export interface InstallInput {
  name: string;
  taxId?: string;
  adminEmail: string;
  adminName: string;
  locale?: 'es' | 'en';
}

/**
 * Alta de la empresa en el servidor de un cliente. La usa la línea de comandos
 * (`pnpm --filter @hr/api cli create-organization ...`), no la web: en modo client
 * nadie puede crear empresas desde la app.
 */
@Injectable()
export class InstallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async createOrganization(input: InstallInput): Promise<{ organizationId: string; setupUrl: string; emailed: boolean }> {
    const email = input.adminEmail.trim().toLowerCase();
    const token = randomBytes(32).toString('base64url');
    const { org, user } = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: input.name, taxId: input.taxId ?? null, settings: { ...DEFAULT_ORGANIZATION_SETTINGS } } });
      // Si la cuenta ya existe se reutiliza; si no, se crea con una contraseña que nadie conoce.
      const user = await tx.user.upsert({
        where: { email },
        create: {
          email,
          fullName: input.adminName,
          locale: input.locale ?? 'es',
          passwordHash: await argon2.hash(randomBytes(32).toString('base64url')),
          emailVerifiedAt: new Date(),
        },
        update: {},
      });
      await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'ADMIN' } });
      // El enlace es el mismo que el de recuperar la contraseña, con más días de validez.
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + SETUP_DAYS * 86_400_000) },
      });
      return { org, user };
    });
    const setupUrl = this.mail.link(`/reset-password?token=${token}`);
    const emailed = await this.mail.send(
      user.email,
      welcomeAdminEmail(user.locale === 'en' ? 'en' : 'es', { name: user.fullName, organization: org.name, url: setupUrl, days: SETUP_DAYS }),
      'welcome_admin',
    );
    return { organizationId: org.id, setupUrl, emailed };
  }

  /**
   * Enlace para elegir contraseña nueva, desde el servidor: para recuperar el acceso cuando no hay correo
   * configurado o nadie puede entrar. Invalida los enlaces anteriores de esa cuenta. Vale 24 horas.
   */
  async resetLink(emailInput: string): Promise<string> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, active: true } });
    if (!user || !user.active) throw new Error(`No hay ninguna cuenta activa con el correo ${email}`);
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) } }),
      // Quien recupera el acceso desde el servidor no debe seguir bloqueado por intentos fallidos.
      this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } }),
    ]);
    return this.mail.link(`/reset-password?token=${token}`);
  }
}
