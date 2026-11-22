import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  APP_NAME,
  EMAIL_GROUP,
  type EmailPrefs,
  type NotificationDto,
  type NotificationList,
  type NotificationPayload,
  type NotificationTypeId,
  type PushSubscriptionInput,
  type QuietHours,
  resolveEmailPrefs,
  resolveSettings,
} from '@hr/shared';
import type { Prisma } from '@prisma/client';
import webpush from 'web-push';
import { parseClock, wallTime } from '../common/tz';
import type { Env } from '../config/env';
import { JobsService } from '../jobs/jobs.service';
import { MailService } from '../mail/mail.service';
import { noticeEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { heldSummaryText, pushText } from './messages';

/** Un push retenido por el horario de desconexión se descarta si lleva más de un día esperando. */
const HOLD_MAX_MS = 24 * 3_600_000;

/** ¿Está la empresa en su horario de desconexión en este instante (hora local)? */
export function isQuiet(q: QuietHours, timezone: string, at: Date): boolean {
  if (!q.enabled) return false;
  const w = wallTime(at, timezone);
  const weekday = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
  if (q.weekends && (weekday === 0 || weekday === 6)) return true;
  const now = w.hour * 60 + w.minute;
  const s = parseClock(q.start);
  const e = parseClock(q.end);
  const start = s.hour * 60 + s.minute;
  const end = e.hour * 60 + e.minute;
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

interface PushBody {
  body: string;
  link: string;
  tag: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly log = new Logger(NotificationsService.name);
  /** null si no hay claves VAPID: los avisos siguen funcionando dentro de la app. */
  readonly publicKey: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    const publicKey = config.get('VAPID_PUBLIC_KEY', { infer: true });
    const privateKey = config.get('VAPID_PRIVATE_KEY', { infer: true });
    if (publicKey && privateKey) {
      webpush.setVapidDetails(config.get('VAPID_SUBJECT', { infer: true }), publicKey, privateKey);
      this.publicKey = publicKey;
    } else {
      this.publicKey = null;
    }
  }

  onModuleInit(): void {
    this.jobs.register({ name: 'avisos-tras-desconexion', schedule: { everyMinutes: 5 }, run: (now) => this.releaseHeld(now) });
  }

  /**
   * Crea el aviso para cada destinatario y, si tienen push activado, se lo envía
   * al móvil. Nunca hace fallar la acción que lo origina: avisar es secundario.
   * Dentro del horario de desconexión de la empresa el aviso se guarda (se ve en la
   * app) pero el push espera a que termine.
   */
  async notify(userIds: string[], organizationId: string | null, type: NotificationTypeId, payload: NotificationPayload): Promise<void> {
    const recipients = [...new Set(userIds)];
    if (!recipients.length) return;
    try {
      const held = organizationId ? await this.quietNow(organizationId, new Date()) : false;
      await this.prisma.notification.createMany({
        data: recipients.map((userId) => ({ userId, organizationId, type, payload: payload as unknown as Prisma.InputJsonValue, pushedAt: held ? null : new Date() })),
      });
      if (held) return;
    } catch (e) {
      this.log.warn(`No se pudo guardar el aviso ${type}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    void this.push(recipients, organizationId, (locale) => ({ body: pushText(locale, type, payload), link: payload.link, tag: type }));
    void this.email(recipients, organizationId, [{ type, payload }]).catch(() => undefined);
  }

  /**
   * El mismo aviso por correo, a quien lo tenga activado para ese tipo. Con varios
   * avisos (los retenidos por la desconexión) va un solo correo con todos.
   */
  private async email(userIds: string[], organizationId: string | null, notices: { type: NotificationTypeId; payload: NotificationPayload }[]): Promise<void> {
    const groups = new Set(notices.map((n) => EMAIL_GROUP[n.type]).filter(Boolean));
    if (!groups.size) return;
    const [users, org] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds }, active: true }, select: { id: true, email: true, fullName: true, locale: true, emailPrefs: true } }),
      organizationId ? this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }) : null,
    ]);
    for (const u of users) {
      const prefs: EmailPrefs = resolveEmailPrefs(u.emailPrefs);
      const mine = notices.filter((n) => {
        const group = EMAIL_GROUP[n.type];
        return group !== null && prefs[group];
      });
      if (!mine.length) continue;
      const locale = u.locale === 'en' ? 'en' : 'es';
      await this.mail.send(
        u.email,
        noticeEmail(locale, {
          name: u.fullName,
          organization: org?.name ?? null,
          lines: mine.map((n) => pushText(locale, n.type, n.payload)),
          url: this.mail.link(mine.length === 1 ? mine[0]!.payload.link : '/'),
          settingsUrl: this.mail.link('/settings'),
        }),
        'notice',
      );
    }
  }

  async emailPrefs(userId: string): Promise<EmailPrefs> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailPrefs: true } });
    return resolveEmailPrefs(u.emailPrefs);
  }

  async setEmailPrefs(userId: string, prefs: EmailPrefs): Promise<EmailPrefs> {
    await this.prisma.user.update({ where: { id: userId }, data: { emailPrefs: prefs } });
    return prefs;
  }

  private async quietNow(organizationId: string, at: Date): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
    if (!org) return false;
    const s = resolveSettings(org.settings);
    return isQuiet(s.quietHours, s.timezone, at);
  }

  /**
   * Terminado el horario de desconexión, envía lo retenido: un push por persona y
   * empresa (el aviso si es uno; un resumen si son varios).
   */
  async releaseHeld(now: Date): Promise<void> {
    const held = await this.prisma.notification.findMany({
      where: { pushedAt: null, organizationId: { not: null } },
      select: { id: true, userId: true, organizationId: true, type: true, payload: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 2000,
    });
    if (!held.length) return;
    const stale = held.filter((n) => now.getTime() - n.createdAt.getTime() > HOLD_MAX_MS).map((n) => n.id);
    if (stale.length) await this.prisma.notification.updateMany({ where: { id: { in: stale } }, data: { pushedAt: now } });

    const fresh = held.filter((n) => !stale.includes(n.id));
    for (const orgId of [...new Set(fresh.map((n) => n.organizationId!))]) {
      if (await this.quietNow(orgId, now)) continue;
      const ofOrg = fresh.filter((n) => n.organizationId === orgId);
      await this.prisma.notification.updateMany({ where: { id: { in: ofOrg.map((n) => n.id) } }, data: { pushedAt: now } });
      for (const userId of [...new Set(ofOrg.map((n) => n.userId))]) {
        const mine = ofOrg.filter((n) => n.userId === userId);
        const only = mine.length === 1 ? mine[0]! : null;
        void this.email([userId], orgId, mine.map((n) => ({ type: n.type, payload: n.payload as unknown as NotificationPayload }))).catch(() => undefined);
        await this.push([userId], orgId, (locale) =>
          only
            ? { body: pushText(locale, only.type, only.payload as unknown as NotificationPayload), link: (only.payload as unknown as NotificationPayload).link, tag: only.type }
            : { body: heldSummaryText(locale, mine.length), link: '/', tag: 'HELD_SUMMARY' },
        );
      }
    }
  }

  /**
   * Quién supervisa a una persona: la administración, los responsables sin
   * departamentos y los responsables de su departamento. Nunca ella misma.
   */
  async supervisors(organizationId: string, subjectUserId: string): Promise<string[]> {
    const [rows, subject] = await Promise.all([
      this.prisma.membership.findMany({
        where: { organizationId, active: true, role: { in: ['ADMIN', 'MANAGER'] }, userId: { not: subjectUserId } },
        select: { userId: true, role: true, manages: { select: { departmentId: true } } },
      }),
      this.prisma.membership.findUnique({ where: { userId_organizationId: { userId: subjectUserId, organizationId } }, select: { departmentId: true } }),
    ]);
    return rows
      .filter((r) => r.role === 'ADMIN' || r.manages.length === 0 || (!!subject?.departmentId && r.manages.some((m) => m.departmentId === subject.departmentId)))
      .map((r) => r.userId);
  }

  async list(userId: string): Promise<NotificationList> {
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        include: { organization: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    const items: NotificationDto[] = rows.map((n) => ({
      id: n.id,
      type: n.type,
      organizationId: n.organizationId,
      organizationName: n.organization?.name ?? null,
      payload: n.payload as unknown as NotificationPayload,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    }));
    return { unread, items };
  }

  /** Marca como leídos los indicados o, sin lista, todos. */
  async markRead(userId: string, ids?: string[]): Promise<void> {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  }

  async subscribe(userId: string, sub: PushSubscriptionInput, userAgent: string | null): Promise<void> {
    // Un mismo navegador puede cambiar de cuenta: la suscripción pasa al usuario actual.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  private async push(userIds: string[], organizationId: string | null, build: (locale: string) => PushBody): Promise<void> {
    if (!this.publicKey) return;
    try {
      const subs = await this.prisma.pushSubscription.findMany({
        where: { userId: { in: userIds } },
        include: { user: { select: { locale: true } } },
      });
      await Promise.all(
        subs.map(async (s) => {
          const msg = build(s.user.locale);
          const body = JSON.stringify({ title: APP_NAME, body: msg.body, link: msg.link, organizationId, tag: msg.tag });
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 86_400 });
            await this.prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            // 404/410: el navegador dio de baja la suscripción; se limpia.
            if (status === 404 || status === 410) await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
            else this.log.warn(`Push no entregado (${status ?? 'red'})`);
          }
        }),
      );
    } catch (e) {
      this.log.warn(`Fallo al enviar push: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
