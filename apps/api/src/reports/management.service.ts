import { ForbiddenException, Injectable } from '@nestjs/common';
import { type PayrollColumn, resolveSettings, type SiteCostReport, type SiteCostRow, type UserHours } from '@hr/shared';
import type { WorkspaceContext } from '../common/context';
import { ScopeService } from '../common/scope.service';
import { fromWallTime } from '../common/tz';
import { PrismaService } from '../prisma/prisma.service';
import { HoursService } from '../time/hours.service';

/** Una fila del archivo para la gestoría: los valores de cada columna. */
export type PayrollRow = Record<PayrollColumn, string | number>;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const hours = (seconds: number): number => round2(seconds / 3600);

/**
 * Informes de gestión para la administración: el archivo mensual para la gestoría
 * (una fila por persona) y el coste estimado de cada obra o centro.
 */
@Injectable()
export class ManagementReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hoursService: HoursService,
    private readonly scope: ScopeService,
  ) {}

  private admin(ws: WorkspaceContext): string {
    if (ws.kind !== 'organization') throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
    if (ws.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    return ws.organizationId;
  }

  private async period(organizationId: string, month: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, settings: true } });
    const s = resolveSettings(org.settings);
    const [year, mon] = month.split('-').map(Number) as [number, number];
    const from = fromWallTime({ year, month: mon, day: 1, hour: 0, minute: 0 }, s.timezone);
    const to = fromWallTime({ year, month: mon + 1, day: 1, hour: 0, minute: 0 }, s.timezone);
    const firstDay = new Date(Date.UTC(year, mon - 1, 1));
    const lastDay = new Date(Date.UTC(year, mon, 0));
    return { org, settings: s, from, to, firstDay, lastDay };
  }

  /** Archivo para la gestoría: horas, ausencias y gastos del mes de cada persona, en las columnas que elija la empresa. */
  async payroll(actorId: string, ws: WorkspaceContext, month: string): Promise<{ organization: string; columns: PayrollColumn[]; rows: PayrollRow[] }> {
    const organizationId = this.admin(ws);
    const { org, settings, from, to, firstDay, lastDay } = await this.period(organizationId, month);
    const [summary, members, late, expenses] = await Promise.all([
      this.hoursService.summary(actorId, ws, from, to, true),
      this.prisma.membership.findMany({
        where: { organizationId, active: true, role: { not: 'INSPECTOR' }, ...(await this.scope.userWhere(actorId, ws)) },
        select: { userId: true, jobTitle: true, user: { select: { fullName: true, dniNie: true } }, department: { select: { name: true } } },
        orderBy: { user: { fullName: 'asc' } },
      }),
      this.prisma.timeEntry.findMany({
        where: { organizationId, voidedAt: null, approvalStatus: 'APPROVED', lateMinutes: { not: null }, startTime: { gte: from, lt: to } },
        distinct: ['workdayId'],
        select: { userId: true },
      }),
      this.prisma.expense.findMany({
        where: { organizationId, status: { in: ['APPROVED', 'REIMBURSED'] }, date: { gte: firstDay, lte: lastDay } },
        select: { userId: true, category: true, amount: true, distanceKm: true },
      }),
    ]);
    const hoursOf = new Map<string, UserHours>(summary.map((u) => [u.user.id, u]));
    const rows = members.map((m): PayrollRow => {
      const h = hoursOf.get(m.userId);
      const mine = expenses.filter((e) => e.userId === m.userId);
      const mileage = mine.filter((e) => e.category === 'MILEAGE');
      const days = h?.absenceDays ?? {};
      const other = Object.entries(days)
        .filter(([type]) => type !== 'VACATION' && type !== 'SICK_LEAVE')
        .reduce((sum, [, n]) => sum + (n ?? 0), 0);
      return {
        dni: m.user.dniNie ?? '',
        name: m.user.fullName,
        department: m.department?.name ?? '',
        jobTitle: m.jobTitle ?? '',
        workedDays: h ? h.days.filter((d) => d.workedSeconds > 0).length : 0,
        workedHours: hours(h?.total.workedSeconds ?? 0),
        ordinaryHours: hours(h?.total.ordinarySeconds ?? 0),
        overtimeHours: hours(h?.total.overtimeSeconds ?? 0),
        nightHours: hours(h?.total.nightSeconds ?? 0),
        travelHours: hours(h?.total.travelSeconds ?? 0),
        plannedHours: hours(h?.total.plannedSeconds ?? 0),
        vacationDays: days.VACATION ?? 0,
        sickDays: days.SICK_LEAVE ?? 0,
        otherAbsenceDays: other,
        lateCount: late.filter((l) => l.userId === m.userId).length,
        expenses: round2(mine.filter((e) => e.category !== 'MILEAGE').reduce((sum, e) => sum + Number(e.amount), 0)),
        mileageKm: round2(mileage.reduce((sum, e) => sum + Number(e.distanceKm ?? 0), 0)),
        mileageAmount: round2(mileage.reduce((sum, e) => sum + Number(e.amount), 0)),
      };
    });
    return { organization: org.name, columns: settings.payrollColumns, rows };
  }

  /**
   * Coste por obra: las horas trabajadas en cada ubicación por el coste por hora de
   * cada persona (con el recargo de las extra, en la proporción de extra de su mes) y
   * los gastos aprobados imputados a esa ubicación.
   */
  async sites(actorId: string, ws: WorkspaceContext, month: string): Promise<SiteCostReport> {
    const organizationId = this.admin(ws);
    const { settings, from, to, firstDay, lastDay } = await this.period(organizationId, month);
    const now = new Date();
    const [entries, summary, members, expenses, locations] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: { organizationId, voidedAt: null, approvalStatus: 'APPROVED', entryType: 'WORK', startTime: { gte: from, lt: to } },
        select: { userId: true, locationId: true, startTime: true, endTime: true },
      }),
      this.hoursService.summary(actorId, ws, from, to, true),
      this.prisma.membership.findMany({ where: { organizationId }, select: { userId: true, hourlyCost: true, user: { select: { fullName: true } } } }),
      this.prisma.expense.findMany({
        where: { organizationId, status: { in: ['APPROVED', 'REIMBURSED'] }, date: { gte: firstDay, lte: lastDay } },
        select: { locationId: true, category: true, amount: true },
      }),
      this.prisma.location.findMany({ where: { organizationId }, select: { id: true, name: true, color: true } }),
    ]);
    const rate = new Map(members.map((m) => [m.userId, m.hourlyCost === null ? null : Number(m.hourlyCost)]));
    const overtimeShare = new Map(summary.map((u) => [u.user.id, u.total.workedSeconds ? u.total.overtimeSeconds / u.total.workedSeconds : 0]));
    const surcharge = settings.overtimeSurchargePct / 100;

    const byLocation = new Map<string | null, { seconds: number; people: Set<string>; cost: number; expenses: SiteCostRow['expenses']; expensesTotal: number }>();
    const row = (id: string | null) => {
      let r = byLocation.get(id);
      if (!r) byLocation.set(id, (r = { seconds: 0, people: new Set(), cost: 0, expenses: {}, expensesTotal: 0 }));
      return r;
    };
    const missing = new Set<string>();
    for (const e of entries) {
      const seconds = Math.max(0, Math.floor(((e.endTime ?? now).getTime() - e.startTime.getTime()) / 1000));
      const r = row(e.locationId);
      r.seconds += seconds;
      r.people.add(e.userId);
      const perHour = rate.get(e.userId);
      if (perHour === null || perHour === undefined) {
        if (seconds > 0) missing.add(e.userId);
        continue;
      }
      r.cost += (seconds / 3600) * perHour * (1 + surcharge * (overtimeShare.get(e.userId) ?? 0));
    }
    for (const x of expenses) {
      const r = row(x.locationId);
      const amount = Number(x.amount);
      r.expenses[x.category] = round2((r.expenses[x.category] ?? 0) + amount);
      r.expensesTotal = round2(r.expensesTotal + amount);
    }
    const loc = new Map(locations.map((l) => [l.id, l]));
    const rows: SiteCostRow[] = [...byLocation.entries()]
      .map(([id, r]) => ({
        location: id ? (loc.get(id) ?? null) : null,
        workedSeconds: r.seconds,
        people: r.people.size,
        laborCost: round2(r.cost),
        expenses: r.expenses,
        expensesTotal: r.expensesTotal,
      }))
      .sort((a, b) => (a.location === null ? 1 : b.location === null ? -1 : b.workedSeconds - a.workedSeconds));
    const names = new Map(members.map((m) => [m.userId, m.user.fullName]));
    return {
      month,
      currency: settings.currency,
      rows,
      total: {
        workedSeconds: rows.reduce((s, r) => s + r.workedSeconds, 0),
        laborCost: round2(rows.reduce((s, r) => s + r.laborCost, 0)),
        expensesTotal: round2(rows.reduce((s, r) => s + r.expensesTotal, 0)),
      },
      missingRates: [...missing].map((id) => ({ id, fullName: names.get(id) ?? '' })).sort((a, b) => a.fullName.localeCompare(b.fullName, 'es')),
    };
  }
}
