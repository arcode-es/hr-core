import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ChangePasswordInput, LoginInput, RegisterInput, ResetPasswordInput, SessionDto } from '@hr/shared';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { RequestMeta } from '../common/context';
import type { Env } from '../config/env';
import { wallTime } from '../common/tz';
import { Deployment } from '../deployment/deployment';
import { MailService } from '../mail/mail.service';
import { passwordChangedEmail, passwordResetEmail, verifyEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** '15m' | '30d' → segundos. */
export function ttlSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) throw new Error(`TTL no válido: ${ttl}`);
  return Number(m[1]) * UNITS[m[2]!]!;
}

export const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/** Validez del enlace para restablecer la contraseña. */
const RESET_TTL_MINUTES = 60;
/** Entre dos correos de restablecimiento a la misma cuenta: evita usar el formulario para inundar un buzón. */
const RESET_COOLDOWN_MS = 60_000;

/** Validez del enlace para confirmar el correo, y espera entre dos envíos. */
const VERIFY_TTL_HOURS = 48;
const VERIFY_COOLDOWN_MS = 60_000;

/** Margen para dos pestañas que renuevan a la vez con el mismo token. */
const ROTATION_GRACE_MS = 15_000;

@Injectable()
export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtl: number;
  private readonly maxAttempts: number;
  private readonly lockMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly deployment: Deployment,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = ttlSeconds(config.get('JWT_ACCESS_TTL', { infer: true }));
    this.refreshTtl = ttlSeconds(config.get('JWT_REFRESH_TTL', { infer: true }));
    this.maxAttempts = config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    this.lockMs = config.get('LOGIN_LOCK_MINUTES', { infer: true }) * 60_000;
  }

  /**
   * Registro según la instalación: en la demo no hay; en el servidor de un cliente
   * solo con una invitación válida para ese correo; en abierto, libre. Entrar con
   * invitación demuestra que el correo es suyo; si no, se le pide confirmarlo.
   */
  async register(dto: RegisterInput, meta: RequestMeta): Promise<IssuedTokens> {
    if (this.deployment.isDemo) throw new ForbiddenException({ code: 'REGISTRATION_CLOSED' });
    const invited = dto.inviteToken ? await this.validInvitation(dto.inviteToken, dto.email) : false;
    if (!this.deployment.openRegistration && !invited) throw new ForbiddenException({ code: 'INVITATION_REQUIRED' });

    const exists = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } });
    if (exists) throw new ConflictException({ code: 'EMAIL_TAKEN' });
    const now = new Date();
    const verified = invited || !this.deployment.emailVerificationRequired;
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        locale: dto.locale ?? 'es',
        passwordHash: await argon2.hash(dto.password),
        lastLoginAt: now,
        emailVerifiedAt: verified ? now : null,
      },
    });
    if (!verified) void this.sendVerification(user.id).catch(() => undefined);
    return this.issue(user.id, meta);
  }

  private dummy: Promise<string> | null = null;
  /** Hash de una contraseña que nadie conoce, calculado una vez, para igualar el coste del acceso. */
  private dummyHash(): Promise<string> {
    return (this.dummy ??= argon2.hash(randomBytes(24).toString('base64url')));
  }

  private async validInvitation(token: string, email: string): Promise<boolean> {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) }, select: { email: true, acceptedAt: true, expiresAt: true } });
    return !!inv && !inv.acceptedAt && inv.expiresAt > new Date() && inv.email.toLowerCase() === email.toLowerCase();
  }

  /**
   * Tras varios intentos fallidos seguidos la cuenta se bloquea unos minutos. En la
   * demo no: cualquiera podría dejar sin acceso a los demás visitantes con claves falsas.
   */
  async login(dto: LoginInput, meta: RequestMeta): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const lockout = !this.deployment.isDemo;
    if (user && lockout && user.lockedUntil && user.lockedUntil > new Date()) throw new ForbiddenException({ code: 'ACCOUNT_LOCKED' });
    // Mismo error para "no existe" y "contraseña incorrecta": no revela qué correos están registrados.
    // Con un correo desconocido se verifica igualmente contra un hash de relleno: así la respuesta
    // tarda lo mismo y el tiempo no delata qué correos están registrados.
    const matches = await argon2.verify(user?.passwordHash ?? (await this.dummyHash()), dto.password).catch(() => false);
    if (!user || !matches) {
      if (user && lockout) {
        // Incremento atómico en la base de datos: intentos simultáneos no se pisan el contador.
        const { failedLogins } = await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
        if (failedLogins >= this.maxAttempts) {
          await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: new Date(Date.now() + this.lockMs) } });
          throw new ForbiddenException({ code: 'ACCOUNT_LOCKED' });
        }
      }
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    // El bloqueo pudo activarse mientras se verificaba esta contraseña (intentos en paralelo).
    if (lockout) {
      const fresh = await this.prisma.user.findUnique({ where: { id: user.id }, select: { lockedUntil: true } });
      if (fresh?.lockedUntil && fresh.lockedUntil > new Date()) throw new ForbiddenException({ code: 'ACCOUNT_LOCKED' });
    }
    if (!user.active) throw new ForbiddenException({ code: 'ACCOUNT_DISABLED' });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
    return this.issue(user.id, meta);
  }

  // ── Confirmación del correo ────────────────────────────────────────────

  /** Envía (o reenvía) el enlace de confirmación. Con un minuto de espera entre envíos. */
  async sendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return;
    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: { userId, createdAt: { gt: new Date(Date.now() - VERIFY_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) return;
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.emailVerificationToken.create({
        data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + VERIFY_TTL_HOURS * 3_600_000) },
      }),
    ]);
    const url = this.mail.link(`/verify-email?token=${token}`);
    await this.mail.send(user.email, verifyEmail(user.locale === 'en' ? 'en' : 'es', { name: user.fullName, url, hours: VERIFY_TTL_HOURS }), 'email_verification');
  }

  /** Confirma el correo con el enlace. Funciona con o sin sesión: el enlace basta. */
  async verifyEmail(token: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!row || row.usedAt || row.expiresAt <= now) throw new BadRequestException({ code: 'VERIFY_INVALID' });
      const { count } = await tx.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (!count) throw new BadRequestException({ code: 'VERIFY_INVALID' });
      await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: now } });
    });
  }

  // ── Sesiones abiertas ──────────────────────────────────────────────────

  /**
   * Dispositivos con la sesión abierta. Cada uno es una cadena de rotación: se
   * muestra el último token vivo de cada cadena, con la fecha en que empezó.
   */
  async sessions(userId: string, currentRaw: string | undefined): Promise<SessionDto[]> {
    const now = new Date();
    const live = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    const families = [...new Set(live.map((t) => t.familyId))];
    const starts = await this.prisma.refreshToken.groupBy({ by: ['familyId'], where: { familyId: { in: families } }, _min: { createdAt: true } });
    const startOf = new Map(starts.map((s) => [s.familyId, s._min.createdAt!]));
    const current = currentRaw ? live.find((t) => t.tokenHash === hashToken(currentRaw))?.familyId : undefined;
    const seen = new Set<string>();
    return live.flatMap((t) => {
      if (seen.has(t.familyId)) return [];
      seen.add(t.familyId);
      return [
        {
          id: t.familyId,
          userAgent: t.userAgent,
          ipAddress: t.ipAddress,
          createdAt: (startOf.get(t.familyId) ?? t.createdAt).toISOString(),
          lastUsedAt: t.createdAt.toISOString(),
          current: t.familyId === current,
        },
      ];
    });
  }

  /** Cierra la sesión de un dispositivo, o de todos menos este si no se indica cuál. */
  async revokeSessions(userId: string, familyId: string | null, currentRaw: string | undefined): Promise<void> {
    const current = currentRaw
      ? await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(currentRaw) }, select: { familyId: true } })
      : null;
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(familyId ? { familyId } : current ? { familyId: { not: current.familyId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  /** Rota el token de renovación. Reutilizar uno ya rotado revoca toda la familia. */
  async refresh(raw: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    const expired = () => new UnauthorizedException({ code: 'SESSION_EXPIRED' });
    if (!raw) throw expired();
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: { select: { active: true } } },
    });
    if (!token || token.expiresAt < new Date() || !token.user.active) throw expired();
    if (token.revokedAt) {
      if (Date.now() - token.revokedAt.getTime() <= ROTATION_GRACE_MS) {
        // Recién rotado y la sesión sigue abierta: dos renovaciones casi a la vez (otra pestaña,
        // o una navegación que cortó la respuesta anterior y el navegador no guardó la cookie
        // nueva). Se emite otro token de la misma cadena. Tras cerrar sesión no queda ninguno vivo.
        const alive = await this.prisma.refreshToken.count({ where: { familyId: token.familyId, revokedAt: null, expiresAt: { gt: new Date() } } });
        if (alive) return this.issue(token.userId, meta, token.familyId);
        throw expired();
      }
      // Reutilizado mucho después: probablemente robado. Se cierra toda la cadena.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: token.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw expired();
    }
    await this.prisma.refreshToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    return this.issue(token.userId, meta, token.familyId);
  }

  /**
   * Cambia la contraseña y cierra el resto de sesiones: quien la conociera en
   * otro dispositivo deja de estar dentro. La sesión actual se conserva.
   */
  async changePassword(userId: string, dto: ChangePasswordInput, currentRefreshToken: string | undefined): Promise<void> {
    this.deployment.assertNotDemo();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    const current = currentRefreshToken
      ? await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(currentRefreshToken) }, select: { familyId: true } })
      : null;
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(dto.newPassword) } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null, ...(current ? { familyId: { not: current.familyId } } : {}) },
        data: { revokedAt: new Date() },
      }),
    ]);
    void this.notifyPasswordChanged(user);
  }

  // ── Recuperación de contraseña ─────────────────────────────────────────

  /**
   * Envía el enlace para restablecer la contraseña. Responde igual exista o no
   * la cuenta y el envío va en segundo plano: ni el contenido ni el tiempo de
   * respuesta revelan qué correos están registrados.
   */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    void this.sendReset(email, meta).catch((e: unknown) => new Logger(AuthService.name).error(`Restablecimiento: ${e instanceof Error ? e.message : String(e)}`));
  }

  private async sendReset(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.active) return;
    const recent = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) return;

    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      // Solo vale el último enlace pedido.
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000), ipAddress: meta.ip },
      }),
    ]);
    const url = this.mail.link(`/reset-password?token=${token}`);
    await this.mail.send(user.email, passwordResetEmail(user.locale === 'en' ? 'en' : 'es', { name: user.fullName, url, minutes: RESET_TTL_MINUTES }), 'password_reset');
  }

  /** Para la pantalla del enlace: saber si sigue valiendo antes de pedir la contraseña nueva. */
  async checkReset(token: string): Promise<{ valid: boolean }> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { active: true } } } });
    return { valid: !!row && !row.usedAt && row.expiresAt > new Date() && row.user.active };
  }

  /** Cambia la contraseña con el enlace del correo y cierra todas las sesiones abiertas. */
  async resetPassword(dto: ResetPasswordInput): Promise<void> {
    this.deployment.assertNotDemo();
    const now = new Date();
    const passwordHash = await argon2.hash(dto.newPassword);
    const user = await this.prisma.$transaction(async (tx) => {
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: hashToken(dto.token) }, include: { user: true } });
      if (!row || row.usedAt || row.expiresAt <= now || !row.user.active) throw new BadRequestException({ code: 'RESET_INVALID' });
      // El filtro por usedAt hace que dos envíos simultáneos del mismo enlace no lo usen dos veces.
      const { count } = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (!count) throw new BadRequestException({ code: 'RESET_INVALID' });
      // Restablecer la contraseña también levanta un bloqueo por intentos fallidos.
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      return row.user;
    });
    void this.notifyPasswordChanged(user);
  }

  /** Aviso de seguridad: si el cambio no lo hizo el titular, se entera y puede reaccionar. */
  private async notifyPasswordChanged(user: { email: string; fullName: string; locale: string; timezone: string }): Promise<void> {
    const w = wallTime(new Date(), user.timezone);
    const pad = (n: number): string => String(n).padStart(2, '0');
    const when = `${pad(w.day)}/${pad(w.month)}/${w.year} ${pad(w.hour)}:${pad(w.minute)}`;
    await this.mail.send(
      user.email,
      passwordChangedEmail(user.locale === 'en' ? 'en' : 'es', { name: user.fullName, when, forgotUrl: this.mail.link('/forgot-password') }),
      'password_changed',
    );
  }

  /** Cierra la sesión de este dispositivo: toda su cadena de tokens, también los de renovaciones simultáneas. */
  async logout(raw: string | undefined): Promise<void> {
    if (!raw) return;
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) }, select: { familyId: true } });
    if (!token) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(userId: string, meta: RequestMeta, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtl * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ip,
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId }, { expiresIn: this.accessTtl });
    return { accessToken, expiresIn: this.accessTtl, refreshToken, refreshExpiresAt };
  }
}
