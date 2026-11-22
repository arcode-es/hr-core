import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { type AlertDto, type AlertKindId, type OrganizationSettings, resolveSettings } from '@hr/shared';
import { Prisma } from '@prisma/client';
import { AbsencesService } from '../absences/absences.service';
import { HolidaysService } from '../absences/holidays.service';
import type { WorkspaceContext } from '../common/context';
import { ScopeService } from '../common/scope.service';
import { fromWallTime, localDate, wallTime } from '../common/tz';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { HoursService } from '../time/hours.service';

const HOUR = 3_600_000;
/** Descanso mínimo entre jornadas (art. 34.3 ET). */
const MIN_REST_HOURS = 12;
/** Máximo de horas ordinarias en un día (art. 34.3 ET). */
const MAX_ORDINARY_HOURS = 9;
/** Una entrada no fichada solo se busca en los turnos que empezaron hace menos de esto. */
const MISSED_LOOKBACK_MS = 12 * HOUR;
/** Horas de más, sobre el límite de jornada abierta, tras las que se avisa también a quien supervisa. */
const LONG_WORKDAY_ESCALATION_HOURS = 4;

const day = (s: string): Date => new Date(`${s}T00:00:00Z`);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Tramos que cuentan: los vigentes, salvo los rechazados y las correcciones aún sin aprobar. */
const counted: Prisma.TimeEntryWhereInput = {
  voidedAt: null,
  OR: [{ approvalStatus: 'APPROVED' }, { approvalStatus: 'PENDING', replacesWorkdayId: null }],
};

const include = {
  user: { select: { id: true, fullName: true } },
  resolvedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AlertInclude;
type Row = Prisma.AlertGetPayload<{ include: typeof include }>;

const toDto = (a: Row): AlertDto => ({
  id: a.id,
  user: a.user,
  kind: a.kind,
  date: a.date.toISOString().slice(0, 10),
  data: a.data as AlertDto['data'],
  createdAt: a.createdAt.toISOString(),
  resolvedAt: a.resolvedAt?.toISOString() ?? null,
  resolvedBy: a.resolvedBy,
});

interface AlertData {
  hours?: number;
  minutes?: number;
  plannedStart?: string;
  limit?: number;
  /** Ya se avisó también a quien supervisa. */
  escalated?: boolean;
}

/**
 * Alertas de jornada: avisan de lo que puede acabar en un incumplimiento del
 * Estatuto de los Trabajadores (descanso, jornada máxima, horas extra) o en un
 * registro incompleto (entrada sin fichar, jornada que nadie cerró). Una por
 * persona, tipo y día; quien supervisa las revisa y las da por resueltas.
 */
@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly log = new Logger('Alertas');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
    private readonly hours: HoursService,
    private readonly holidays: HolidaysService,
    private readonly absences: AbsencesService,
    private readonly scope: ScopeService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'alertas-de-jornada', schedule: { everyMinutes: 5 }, run: (now) => this.scan(now) });
    this.jobs.register({ name: 'alertas-diarias', schedule: { dailyAt: '06:00' }, run: (now) => this.daily(now) });
  }

  // ── Consulta ───────────────────────────────────────────────────────────

  private org(ws: WorkspaceContext): string {
    if (ws.kind !== 'organization') throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
    return ws.organizationId;
  }

  async list(actorId: string, ws: WorkspaceContext, status: 'open' | 'all'): Promise<AlertDto[]> {
    const rows = await this.prisma.alert.findMany({
      where: { organizationId: this.org(ws), ...(status === 'open' ? { resolvedAt: null } : {}), ...(await this.scope.userWhere(actorId, ws)) },
      include,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    return rows.map(toDto);
  }

  async resolve(actorId: string, ws: WorkspaceContext, id: string): Promise<AlertDto> {
    const organizationId = this.org(ws);
    const found = await this.prisma.alert.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.scope.assertVisible(actorId, ws, found.userId);
    const row = await this.prisma.alert.update({
      where: { id },
      data: found.resolvedAt ? {} : { resolvedAt: new Date(), resolvedById: actorId },
      include,
    });
    return toDto(row);
  }

  // ── Detección ──────────────────────────────────────────────────────────

  /** Empresas con las alertas activadas, de entre las indicadas. */
  private async organizations(ids: Iterable<string | null>): Promise<{ id: string; settings: OrganizationSettings }[]> {
    const wanted = [...new Set([...ids].filter((id): id is string => !!id))];
    if (!wanted.length) return [];
    const rows = await this.prisma.organization.findMany({ where: { id: { in: wanted } }, select: { id: true, settings: true } });
    return rows.map((o) => ({ id: o.id, settings: resolveSettings(o.settings) })).filter((o) => o.settings.alertsEnabled);
  }

  /** Empresas con algo que revisar: así una instalación con muchas empresas no las recorre todas cada vez. */
  private async active(where: { shiftsSince?: Date; shiftsUntil?: Date; entriesSince?: Date; open?: boolean }): Promise<Set<string>> {
    const ids = new Set<string>();
    if (where.shiftsSince) {
      const rows = await this.prisma.shift.findMany({
        where: { organizationId: { not: null }, publishedAt: { not: null }, plannedStart: { gte: where.shiftsSince, lte: where.shiftsUntil } },
        distinct: ['organizationId'],
        select: { organizationId: true },
      });
      rows.forEach((r) => r.organizationId && ids.add(r.organizationId));
    }
    if (where.entriesSince || where.open) {
      const rows = await this.prisma.timeEntry.findMany({
        where: { organizationId: { not: null }, voidedAt: null, OR: [...(where.entriesSince ? [{ startTime: { gte: where.entriesSince } }] : []), ...(where.open ? [{ endTime: null }] : [])] },
        distinct: ['organizationId'],
        select: { organizationId: true },
      });
      rows.forEach((r) => r.organizationId && ids.add(r.organizationId));
    }
    return ids;
  }

  /** Cada pocos minutos: entradas sin fichar, jornadas abiertas demasiado tiempo y descansos cortos. */
  async scan(now: Date): Promise<void> {
    const ids = await this.active({ shiftsSince: new Date(now.getTime() - MISSED_LOOKBACK_MS), shiftsUntil: now, entriesSince: new Date(now.getTime() - 24 * HOUR), open: true });
    for (const org of await this.organizations(ids)) {
      try {
        await this.missedClockIns(org.id, org.settings, now);
        await this.longWorkdays(org.id, org.settings, now);
        await this.shortRests(org.id, org.settings, now);
      } catch (e) {
        this.log.warn(`Empresa ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** Una vez al día: jornadas de ayer con más de 9 h ordinarias y horas extra del año. */
  async daily(now: Date): Promise<void> {
    // Las horas extra necesitan turnos con los que comparar; las jornadas largas, fichajes recientes.
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1) - 86_400_000);
    const ids = await this.active({ shiftsSince: yearStart, shiftsUntil: now, entriesSince: new Date(now.getTime() - 48 * HOUR) });
    for (const org of await this.organizations(ids)) {
      try {
        await this.longOrdinaryDays(org.id, org.settings, now);
        await this.overtimeYear(org.id, org.settings, now);
      } catch (e) {
        this.log.warn(`Empresa ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** Crea la alerta si no existe (una por persona, tipo y día). Devuelve null si ya estaba. */
  private async raise(organizationId: string, userId: string, kind: AlertKindId, date: string, data: AlertData): Promise<{ id: string } | null> {
    try {
      return await this.prisma.alert.create({ data: { organizationId, userId, kind, date: day(date), data: data as Prisma.InputJsonValue }, select: { id: true } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null;
      throw e;
    }
  }

  private async name(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    return u?.fullName ?? '';
  }

  private async tellWorker(organizationId: string, userId: string, kind: AlertKindId, data: AlertData): Promise<void> {
    await this.notifications.notify([userId], organizationId, 'ALERT', { link: '/clock', alertKind: kind, hours: data.hours, minutes: data.minutes });
  }

  private async tellSupervisors(organizationId: string, userId: string, kind: AlertKindId, data: AlertData): Promise<void> {
    const to = await this.notifications.supervisors(organizationId, userId);
    await this.notifications.notify(to, organizationId, 'ALERT', { link: '/alerts', alertKind: kind, name: await this.name(userId), hours: data.hours, minutes: data.minutes });
  }

  private async activeMembers(organizationId: string, userIds: string[]): Promise<Set<string>> {
    const rows = await this.prisma.membership.findMany({ where: { organizationId, active: true, userId: { in: userIds }, role: { not: 'INSPECTOR' } }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
  }

  /**
   * Turno empezado hace más de X minutos sin ninguna entrada fichada: se avisa a la
   * persona; si al doble de tiempo sigue sin fichar, también a quien supervisa.
   */
  async missedClockIns(organizationId: string, s: OrganizationSettings, now: Date): Promise<void> {
    const threshold = s.missedClockInMinutes * 60_000;
    const shifts = await this.prisma.shift.findMany({
      where: { organizationId, publishedAt: { not: null }, plannedStart: { gte: new Date(now.getTime() - MISSED_LOOKBACK_MS), lte: new Date(now.getTime() - threshold) } },
      select: { id: true, userId: true, date: true, plannedStart: true, plannedEnd: true, locationId: true },
    });
    if (!shifts.length) return;
    const userIds = [...new Set(shifts.map((x) => x.userId))];
    const dates = shifts.map((x) => x.date.toISOString().slice(0, 10)).sort();
    const [members, calendar, absent] = await Promise.all([
      this.activeMembers(organizationId, userIds),
      this.holidays.calendar(organizationId, dates[0]!, dates.at(-1)!),
      this.absences.approvedDays(organizationId, userIds, dates[0]!, dates.at(-1)!),
    ]);

    for (const shift of shifts) {
      const date = shift.date.toISOString().slice(0, 10);
      if (!members.has(shift.userId) || absent.get(shift.userId)?.has(date) || calendar.isHoliday(date, shift.locationId)) continue;
      // Cuenta cualquier fichaje desde un rato antes del turno (quien llega pronto) hasta ahora.
      const clocked = await this.prisma.timeEntry.findFirst({
        where: { organizationId, userId: shift.userId, AND: [counted, { OR: [{ startTime: { gte: new Date(shift.plannedStart.getTime() - 3 * HOUR), lte: now } }, { endTime: null }] }] },
        select: { id: true },
      });
      if (clocked) continue;
      const minutes = Math.floor((now.getTime() - shift.plannedStart.getTime()) / 60_000);
      const data: AlertData = { minutes, plannedStart: shift.plannedStart.toISOString() };
      const created = await this.raise(organizationId, shift.userId, 'MISSED_CLOCK_IN', date, data);
      if (created) {
        await this.tellWorker(organizationId, shift.userId, 'MISSED_CLOCK_IN', data);
        continue;
      }
      if (now.getTime() - shift.plannedStart.getTime() >= 2 * threshold) await this.escalate(organizationId, shift.userId, 'MISSED_CLOCK_IN', date, { minutes });
    }
  }

  /** Avisa a quien supervisa de una alerta ya creada, una sola vez y si sigue sin resolver. */
  private async escalate(organizationId: string, userId: string, kind: AlertKindId, date: string, extra: AlertData): Promise<void> {
    const alert = await this.prisma.alert.findUnique({ where: { organizationId_userId_kind_date: { organizationId, userId, kind, date: day(date) } } });
    if (!alert || alert.resolvedAt || (alert.data as AlertData).escalated) return;
    const data = { ...(alert.data as AlertData), ...extra, escalated: true };
    // Las tareas no se solapan (cada turno lo ejecuta una sola instancia): basta con marcarla.
    await this.prisma.alert.update({ where: { id: alert.id }, data: { data: data as Prisma.InputJsonValue } });
    await this.tellSupervisors(organizationId, userId, kind, data);
  }

  /** Jornada abierta más de `maxOpenHours`: probablemente se olvidó fichar la salida. */
  async longWorkdays(organizationId: string, s: OrganizationSettings, now: Date): Promise<void> {
    const open = await this.prisma.timeEntry.findMany({ where: { organizationId, endTime: null, ...counted }, select: { userId: true, workdayId: true } });
    if (!open.length) return;
    const starts = await this.prisma.timeEntry.groupBy({
      by: ['workdayId', 'userId'],
      where: { organizationId, workdayId: { in: open.map((o) => o.workdayId) }, ...counted },
      _min: { startTime: true },
    });
    for (const w of starts) {
      const start = w._min.startTime;
      if (!start) continue;
      const elapsed = (now.getTime() - start.getTime()) / HOUR;
      if (elapsed < s.maxOpenHours) continue;
      const date = localDate(start, s.timezone);
      const data: AlertData = { hours: s.maxOpenHours };
      if (await this.raise(organizationId, w.userId, 'LONG_WORKDAY', date, data)) {
        await this.tellWorker(organizationId, w.userId, 'LONG_WORKDAY', data);
      } else if (elapsed >= s.maxOpenHours + LONG_WORKDAY_ESCALATION_HOURS) {
        await this.escalate(organizationId, w.userId, 'LONG_WORKDAY', date, { hours: s.maxOpenHours + LONG_WORKDAY_ESCALATION_HOURS });
      }
    }
  }

  /** Jornadas empezadas en las últimas 24 h con menos de 12 h de descanso desde la anterior. */
  async shortRests(organizationId: string, s: OrganizationSettings, now: Date): Promise<void> {
    const since = new Date(now.getTime() - 24 * HOUR);
    const recent = await this.prisma.timeEntry.groupBy({
      by: ['workdayId', 'userId'],
      where: { organizationId, ...counted },
      _min: { startTime: true },
      having: { startTime: { _min: { gte: since } } },
    });
    for (const w of recent) {
      const start = w._min.startTime;
      if (!start) continue;
      const previous = await this.prisma.timeEntry.findFirst({
        where: { organizationId, userId: w.userId, workdayId: { not: w.workdayId }, endTime: { lte: start, gte: new Date(start.getTime() - MIN_REST_HOURS * HOUR) }, ...counted },
        orderBy: { endTime: 'desc' },
        select: { endTime: true },
      });
      if (!previous?.endTime) continue;
      const rest = (start.getTime() - previous.endTime.getTime()) / HOUR;
      const data: AlertData = { hours: round1(rest) };
      if (await this.raise(organizationId, w.userId, 'SHORT_REST', localDate(start, s.timezone), data)) {
        await this.tellSupervisors(organizationId, w.userId, 'SHORT_REST', data);
      }
    }
  }

  /** Alguien con permisos para leer las horas de toda la plantilla (las alertas no tienen usuario propio). */
  private async reader(organizationId: string): Promise<{ actorId: string; ws: WorkspaceContext } | null> {
    const admin = await this.prisma.membership.findFirst({ where: { organizationId, active: true, role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
    if (!admin) return null;
    return { actorId: admin.userId, ws: { kind: 'organization', organizationId, role: 'ADMIN', membershipId: admin.id } };
  }

  /** Días de ayer con más de 9 h ordinarias (lo planificado o, sin turnos, todo lo trabajado). */
  async longOrdinaryDays(organizationId: string, s: OrganizationSettings, now: Date): Promise<void> {
    const r = await this.reader(organizationId);
    if (!r) return;
    const today = wallTime(now, s.timezone);
    const to = fromWallTime({ ...today, hour: 0, minute: 0 }, s.timezone);
    const from = fromWallTime({ ...today, day: today.day - 1, hour: 0, minute: 0 }, s.timezone);
    const rows = await this.hours.summary(r.actorId, r.ws, from, to, true);
    for (const u of rows) {
      for (const d of u.days) {
        if (d.ordinarySeconds <= MAX_ORDINARY_HOURS * 3600) continue;
        const data: AlertData = { hours: round1(d.ordinarySeconds / 3600) };
        if (await this.raise(organizationId, u.user.id, 'LONG_ORDINARY_DAY', d.date, data)) await this.tellSupervisors(organizationId, u.user.id, 'LONG_ORDINARY_DAY', data);
      }
    }
  }

  /** Horas extra del año al 70 % y al 100 % del límite (80 h por defecto, art. 35.2 ET). */
  async overtimeYear(organizationId: string, s: OrganizationSettings, now: Date): Promise<void> {
    const r = await this.reader(organizationId);
    if (!r || s.overtimeYearLimit <= 0) return;
    const year = wallTime(now, s.timezone).year;
    const from = fromWallTime({ year, month: 1, day: 1, hour: 0, minute: 0 }, s.timezone);
    const rows = await this.hours.summary(r.actorId, r.ws, from, now, true);
    const date = `${year}-01-01`;
    for (const u of rows) {
      const hours = u.total.overtimeSeconds / 3600;
      for (const [kind, share] of [['OVERTIME_YEAR_100', 1], ['OVERTIME_YEAR_70', 0.7]] as const) {
        if (hours < s.overtimeYearLimit * share) continue;
        const data: AlertData = { hours: round1(hours), limit: s.overtimeYearLimit };
        if (await this.raise(organizationId, u.user.id, kind, date, data)) await this.tellSupervisors(organizationId, u.user.id, kind, data);
        break;
      }
    }
  }
}
