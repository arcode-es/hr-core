import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { resolveEmailPrefs, resolveSettings } from '@hr/shared';
import type { WorkspaceContext } from '../common/context';
import { ScopeService } from '../common/scope.service';
import { JobsService } from '../jobs/jobs.service';
import { MailService } from '../mail/mail.service';
import { digestEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { isQuiet } from './notifications.service';

type Counts = { entries: number; expenses: number; absences: number; alerts: number; overdue: number };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function lines(c: Counts, locale: 'es' | 'en'): string[] {
  const en = locale === 'en';
  const out: string[] = [];
  if (c.entries) out.push(en ? plural(c.entries, 'workday to validate', 'workdays to validate') : plural(c.entries, 'jornada por validar', 'jornadas por validar'));
  if (c.expenses) out.push(en ? plural(c.expenses, 'expense to approve', 'expenses to approve') : plural(c.expenses, 'gasto por aprobar', 'gastos por aprobar'));
  if (c.absences) out.push(en ? plural(c.absences, 'absence request', 'absence requests') : plural(c.absences, 'ausencia por aprobar', 'ausencias por aprobar'));
  if (c.alerts) out.push(en ? plural(c.alerts, 'open working-time alert', 'open working-time alerts') : plural(c.alerts, 'alerta de jornada abierta', 'alertas de jornada abiertas'));
  if (c.overdue) out.push(en ? plural(c.overdue, 'overdue document', 'overdue documents') : plural(c.overdue, 'documento vencido sin firmar o leer', 'documentos vencidos sin firmar o leer'));
  return out;
}

/**
 * Resumen diario por correo para la administración y los responsables: lo que
 * espera su decisión. Solo si hay algo, solo a quien lo tiene activado y nunca en
 * el horario de desconexión de la empresa.
 */
@Injectable()
export class DigestService implements OnModuleInit {
  private readonly log = new Logger('Resumen diario');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    private readonly scope: ScopeService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'resumen-diario', schedule: { dailyAt: '08:00' }, run: (now) => this.run(now) });
  }

  async counts(actorId: string, ws: Extract<WorkspaceContext, { kind: 'organization' }>, now: Date): Promise<Counts> {
    const mine = await this.scope.userWhere(actorId, ws);
    const organizationId = ws.organizationId;
    const supervises = ws.role === 'ADMIN' || ws.role === 'MANAGER';
    const [entries, expenses, absences, alerts, overdue] = await Promise.all([
      supervises
        ? this.prisma.timeEntry.findMany({ where: { organizationId, voidedAt: null, approvalStatus: 'PENDING', AND: [{ userId: { not: actorId } }, mine] }, distinct: ['workdayId'], select: { workdayId: true } })
        : [],
      supervises ? this.prisma.expense.count({ where: { organizationId, status: 'PENDING', AND: [{ userId: { not: actorId } }, mine] } }) : 0,
      supervises ? this.prisma.absence.count({ where: { organizationId, status: 'PENDING', AND: [{ userId: { not: actorId } }, mine] } }) : 0,
      this.prisma.alert.count({ where: { organizationId, resolvedAt: null, ...mine } }),
      this.prisma.document.count({
        where: {
          organizationId,
          ...(ws.role === 'ADMIN' ? {} : { senderId: actorId }),
          dueDate: { lt: new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`) },
          OR: [{ requiresSignature: true, status: { not: 'SIGNED' } }, { requiresSignature: false, status: 'SENT' }],
        },
      }),
    ]);
    return { entries: entries.length, expenses, absences, alerts, overdue };
  }

  /** `only`: limitar a esas empresas (pruebas). */
  async run(now: Date, only?: string[]): Promise<void> {
    const memberships = await this.prisma.membership.findMany({
      where: { active: true, role: { in: ['ADMIN', 'MANAGER'] }, user: { active: true }, organization: { isDemo: false }, ...(only ? { organizationId: { in: only } } : {}) },
      include: { user: { select: { id: true, email: true, fullName: true, locale: true, emailPrefs: true } }, organization: { select: { name: true, settings: true } } },
    });
    for (const m of memberships) {
      if (!resolveEmailPrefs(m.user.emailPrefs).digest) continue;
      const s = resolveSettings(m.organization.settings);
      if (isQuiet(s.quietHours, s.timezone, now)) continue;
      try {
        const c = await this.counts(m.userId, { kind: 'organization', organizationId: m.organizationId, role: m.role, membershipId: m.id }, now);
        const locale = m.user.locale === 'en' ? 'en' : 'es';
        const text = lines(c, locale);
        if (!text.length) continue;
        await this.mail.send(
          m.user.email,
          digestEmail(locale, { name: m.user.fullName, organization: m.organization.name, lines: text, url: this.mail.link('/'), settingsUrl: this.mail.link('/settings') }),
          'digest',
        );
      } catch (e) {
        this.log.warn(`Resumen de ${m.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
