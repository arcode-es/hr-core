import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { resolveSettings, type TimesheetsSent } from '@hr/shared';
import type { WorkspaceContext } from '../common/context';
import { fromWallTime, localDate, wallTime } from '../common/tz';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { timesheetPdf } from '../reports/timesheet.render';
import { DocumentsService } from './documents.service';

const DAY = 86_400_000;
/** Recordatorios una vez vencido: cada 3 días, como mucho 3. */
const OVERDUE_EVERY = 3;
const OVERDUE_MAX = 3;
/** Plazo para firmar el registro mensual. */
const TIMESHEET_DUE_DAYS = 7;

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY;
const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const monthLabel = (month: string): string => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));

/**
 * Tareas de documentos: los recordatorios de lo que tiene fecha límite y el envío
 * del registro de jornada de cada mes para que cada persona lo firme (art. 35.5 ET:
 * la empresa debe entregar a cada trabajador el resumen de su jornada).
 */
@Injectable()
export class DocumentJobsService implements OnModuleInit {
  private readonly log = new Logger('Documentos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly documents: DocumentsService,
    private readonly reports: ReportsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'recordatorios-de-documentos', schedule: { dailyAt: '09:00' }, run: (now) => this.remind(now) });
    this.jobs.register({ name: 'registro-mensual', schedule: { dailyAt: '07:00' }, run: (now) => this.monthly(now) });
  }

  /**
   * Recuerda lo pendiente con fecha límite: 3 días antes, el mismo día y, ya
   * vencido, cada 3 días (como mucho 3 veces). Cada documento, una vez al día.
   */
  async remind(now: Date): Promise<void> {
    const docs = await this.prisma.document.findMany({
      where: {
        dueDate: { gte: new Date(now.getTime() - (OVERDUE_EVERY * OVERDUE_MAX + 2) * DAY), lte: new Date(now.getTime() + 4 * DAY) },
        OR: [{ requiresSignature: true, status: { not: 'SIGNED' } }, { requiresSignature: false, status: 'SENT' }],
        recipient: { active: true },
      },
      select: { id: true, organizationId: true, recipientId: true, title: true, dueDate: true, lastReminderAt: true, organization: { select: { settings: true } } },
    });
    for (const d of docs) {
      const tz = resolveSettings(d.organization.settings).timezone;
      const today = localDate(now, tz);
      if (d.lastReminderAt && localDate(d.lastReminderAt, tz) === today) continue;
      const due = d.dueDate!.toISOString().slice(0, 10);
      const diff = dayNumber(today) - dayNumber(due);
      const send = diff === -3 || diff === 0 || (diff > 0 && diff % OVERDUE_EVERY === 0 && diff / OVERDUE_EVERY <= OVERDUE_MAX);
      if (!send) continue;
      await this.prisma.document.update({ where: { id: d.id }, data: { remindersSent: { increment: 1 }, lastReminderAt: now } });
      await this.notifications.notify([d.recipientId], d.organizationId, 'DOCUMENT_REMINDER', { link: `/documents/${d.id}`, title: d.title, dueDate: due, overdue: diff > 0 });
    }
  }

  /** Cada día, a partir del día elegido por la empresa, envía lo que falte del registro del mes anterior. */
  async monthly(now: Date): Promise<void> {
    const orgs = await this.prisma.organization.findMany({ select: { id: true, settings: true } });
    for (const org of orgs) {
      const s = resolveSettings(org.settings);
      if (!s.monthlyTimesheet.enabled) continue;
      const w = wallTime(now, s.timezone);
      if (w.day < s.monthlyTimesheet.day) continue;
      const prev = new Date(Date.UTC(w.year, w.month - 2, 1));
      const month = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
      const admin = await this.prisma.membership.findFirst({ where: { organizationId: org.id, active: true, role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
      if (!admin) continue;
      try {
        const r = await this.sendTimesheets(admin.userId, { kind: 'organization', organizationId: org.id, role: 'ADMIN', membershipId: admin.id }, month);
        if (r.sent) this.log.log(`Registro de ${month}: ${r.sent} enviados (empresa ${org.id})`);
      } catch (e) {
        this.log.warn(`Registro de ${month} de la empresa ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /**
   * Envía a cada persona que trabajó ese mes su registro de jornada en PDF, para
   * firmar o confirmar la lectura según la empresa. Quien ya lo tiene, se salta.
   */
  async sendTimesheets(actorId: string, ws: WorkspaceContext, month: string): Promise<TimesheetsSent> {
    if (ws.kind !== 'organization' || ws.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ws.organizationId }, select: { settings: true } });
    const s = resolveSettings(org.settings);
    const [year, mon] = month.split('-').map(Number) as [number, number];
    const from = fromWallTime({ year, month: mon, day: 1, hour: 0, minute: 0 }, s.timezone);
    const to = fromWallTime({ year, month: mon + 1, day: 1, hour: 0, minute: 0 }, s.timezone);

    const [worked, members, already] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: { organizationId: ws.organizationId, voidedAt: null, approvalStatus: 'APPROVED', startTime: { gte: from, lt: to } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.membership.findMany({ where: { organizationId: ws.organizationId, active: true, role: { not: 'INSPECTOR' } }, select: { userId: true } }),
      this.prisma.document.findMany({ where: { organizationId: ws.organizationId, period: month }, select: { recipientId: true } }),
    ]);
    const active = new Set(members.map((m) => m.userId));
    const done = new Set(already.map((d) => d.recipientId));
    const due = addDays(localDate(new Date(), s.timezone), TIMESHEET_DUE_DAYS);
    const label = monthLabel(month);
    let sent = 0;
    let skipped = 0;
    for (const { userId } of worked) {
      if (!active.has(userId)) continue;
      if (done.has(userId)) {
        skipped++;
        continue;
      }
      const report = await this.reports.timesheet(actorId, ws, month, userId);
      await this.documents.send(
        actorId,
        ws,
        {
          title: `Registro de jornada de ${label}`,
          category: 'TIMESHEET',
          requiresSignature: s.monthlyTimesheet.requireSignature,
          recipients: [userId],
          dueDate: due,
        },
        { buffer: await timesheetPdf(report), originalName: `registro-jornada-${month}.pdf` },
        { period: month, includeSelf: true },
      );
      sent++;
    }
    return { sent, skipped };
  }
}
