import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type AbsenceTypeId, type DayHours, type HoursBag, resolveSettings } from '@hr/shared';
import type { Expense, TimeEntry } from '@prisma/client';
import { AbsencesService } from '../absences/absences.service';
import { HolidaysService } from '../absences/holidays.service';
import type { WorkspaceContext } from '../common/context';
import { fromWallTime, localDate } from '../common/tz';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftsService } from '../shifts/shifts.service';
import { Storage } from '../storage/storage';
import { computeBags } from '../time/bags';

export interface ReportHeader {
  /** null en el espacio personal. */
  organization: { name: string; taxId: string | null } | null;
  person: { fullName: string; dniNie: string | null };
  month: string;
  timezone: string;
  generatedAt: Date;
  /** Marca del cliente para la cabecera del PDF. */
  brand?: { name: string | null; logo: Buffer | null };
}

export type ReportSegment = TimeEntry & { location: { name: string } | null };

export interface TimesheetDay extends DayHours {
  segments: ReportSegment[];
  /** Festivo o ausencia aprobada de ese día («Festivo: Navidad», «Vacaciones»). */
  off: string | null;
}

export interface TimesheetReport extends ReportHeader {
  hasPlan: boolean;
  /** Todos los días del mes, hayan tenido jornada o no. */
  days: TimesheetDay[];
  total: HoursBag;
  /** Jornada anual pactada y lo trabajado en el año hasta el final del mes (si se ha indicado). */
  annual: { agreedHours: number; workedSeconds: number } | null;
}

const ABSENCE_ES: Record<AbsenceTypeId, string> = {
  VACATION: 'Vacaciones',
  PERSONAL: 'Asuntos propios',
  SICK_LEAVE: 'Baja médica',
  PAID_LEAVE: 'Permiso retribuido',
  UNPAID: 'Permiso no retribuido',
  OTHER: 'Ausencia',
};

export type ReportExpense = Expense & { location: { name: string } | null; customCategory: { name: string } | null };

export interface ExpenseReport extends ReportHeader {
  currency: string;
  expenses: ReportExpense[];
}

const emptyBag = (): HoursBag => ({
  plannedSeconds: 0,
  workedSeconds: 0,
  ordinarySeconds: 0,
  overtimeSeconds: 0,
  nightSeconds: 0,
  travelSeconds: 0,
  breakSeconds: 0,
  absenceSeconds: 0,
});

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: ShiftsService,
    private readonly storage: Storage,
    private readonly holidays: HolidaysService,
    private readonly absences: AbsencesService,
    private readonly scope: ScopeService,
  ) {}

  /** Cada uno saca sus informes; los de otra persona, solo quien supervisa su empresa. */
  private async subject(actorId: string, ws: WorkspaceContext, userId?: string): Promise<string> {
    if (!userId || userId === actorId) return actorId;
    if (ws.kind !== 'organization' || ws.role === 'EMPLOYEE') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const member = await this.prisma.membership.findFirst({ where: { userId, organizationId: ws.organizationId }, select: { id: true } });
    if (!member) throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.scope.assertVisible(actorId, ws, userId);
    return userId;
  }

  private async header(actorId: string, ws: WorkspaceContext, userId: string, month: string): Promise<ReportHeader> {
    const [person, org, settings] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, dniNie: true } }),
      ws.kind === 'organization'
        ? this.prisma.organization.findUniqueOrThrow({ where: { id: ws.organizationId }, select: { name: true, taxId: true } })
        : null,
      this.shifts.settings(actorId, ws),
    ]);
    const brand = ws.kind === 'organization' ? await this.brand(ws.organizationId) : undefined;
    return { organization: org, person, month, timezone: settings.timezone, generatedAt: new Date(), brand };
  }

  private async brand(organizationId: string): Promise<ReportHeader['brand']> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
    const s = resolveSettings(org?.settings);
    if (!s.brandName && !s.logoKey) return undefined;
    return { name: s.brandName || null, logo: s.logoKey ? await this.storage.get(s.logoKey).catch(() => null) : null };
  }

  /** Registro de jornada del mes: solo tramos vigentes y aprobados. */
  async timesheet(actorId: string, ws: WorkspaceContext, month: string, userId?: string): Promise<TimesheetReport> {
    const subject = await this.subject(actorId, ws, userId);
    const header = await this.header(actorId, ws, subject, month);
    const settings = await this.shifts.settings(actorId, ws);
    const [year, mon] = month.split('-').map(Number) as [number, number];
    const from = fromWallTime({ year, month: mon, day: 1, hour: 0, minute: 0 }, header.timezone);
    const to = fromWallTime({ year, month: mon + 1, day: 1, hour: 0, minute: 0 }, header.timezone);
    const DAY = 86_400_000;

    const [entries, shifts] = await Promise.all([
      // Con margen de un día: una jornada nocturna puede cruzar el cambio de mes.
      this.prisma.timeEntry.findMany({
        where: {
          userId: subject,
          organizationId: ws.organizationId,
          voidedAt: null,
          approvalStatus: 'APPROVED',
          startTime: { gte: new Date(from.getTime() - DAY), lt: new Date(to.getTime() + DAY) },
        },
        include: { location: { select: { name: true } } },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.shift.findMany({
        where: { userId: subject, organizationId: ws.organizationId, publishedAt: { not: null }, plannedStart: { gte: from, lt: to } },
        select: { date: true, plannedStart: true, plannedEnd: true, breakMinutes: true, locationId: true },
      }),
    ]);

    // Festivos y ausencias aprobadas del mes: no son tiempo previsto y se anotan en el día.
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(new Date(Date.UTC(year, mon, 0)).getUTCDate()).padStart(2, '0')}`;
    const org = ws.kind === 'organization' ? ws.organizationId : null;
    const holidayList = org ? await this.holidays.list(org, monthStart, monthEnd) : [];
    const calendar = org ? await this.holidays.calendar(org, monthStart, monthEnd) : null;
    const absent = org ? ((await this.absences.approvedDays(org, [subject], monthStart, monthEnd)).get(subject) ?? new Map<string, AbsenceTypeId>()) : new Map<string, AbsenceTypeId>();
    const offLabel = (date: string): string | null => {
      const a = absent.get(date);
      if (a) return ABSENCE_ES[a] ?? null;
      const h = holidayList.find((x) => x.date === date && !x.location);
      return h ? `Festivo: ${h.name}` : null;
    };

    // Una jornada pertenece al mes en que empieza, entera.
    const firstStart = new Map<string, Date>();
    for (const e of entries) if (!firstStart.has(e.workdayId)) firstStart.set(e.workdayId, e.startTime);
    const inMonth = entries.filter((e) => {
      const start = firstStart.get(e.workdayId)!;
      return start >= from && start < to;
    });

    const bags = computeBags(
      inMonth,
      shifts.map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) })),
      settings,
      header.generatedAt,
      (date, locationId) => (absent.has(date) ? 'absence' : calendar?.isHoliday(date, locationId) ? 'holiday' : null),
    );
    const byDate = new Map(bags.days.map((d) => [d.date, d]));
    const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    const days: TimesheetDay[] = [];
    for (let d = 1; d <= lastDay; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      days.push({
        date,
        ...(byDate.get(date) ?? emptyBag()),
        segments: inMonth.filter((e) => localDate(firstStart.get(e.workdayId)!, header.timezone) === date),
        off: offLabel(date),
      });
    }
    return { ...header, hasPlan: bags.hasPlan, days, total: bags.total, annual: await this.annual(subject, ws, year, to) };
  }

  /** Registro de cada persona activa que ve quien lo pide, por orden alfabético. */
  async teamTimesheets(actorId: string, ws: WorkspaceContext, month: string): Promise<{ organization: string; reports: TimesheetReport[] }> {
    if (ws.kind !== 'organization' || ws.role === 'EMPLOYEE') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const [org, members] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: ws.organizationId }, select: { name: true } }),
      this.prisma.membership.findMany({
        where: { organizationId: ws.organizationId, active: true, role: { not: 'INSPECTOR' }, ...(await this.scope.userWhere(actorId, ws)) },
        select: { userId: true },
        orderBy: { user: { fullName: 'asc' } },
      }),
    ]);
    const reports: TimesheetReport[] = [];
    for (const m of members) reports.push(await this.timesheet(actorId, ws, month, m.userId));
    return { organization: org.name, reports };
  }

  /** Jornada anual del convenio frente a lo trabajado (aprobado) desde el 1 de enero hasta el final del mes. */
  private async annual(userId: string, ws: WorkspaceContext, year: number, until: Date): Promise<TimesheetReport['annual']> {
    if (ws.kind !== 'organization') return null;
    const member = await this.prisma.membership.findFirst({ where: { userId, organizationId: ws.organizationId }, select: { annualHours: true } });
    if (!member?.annualHours) return null;
    const settings = await this.shifts.settings(userId, ws);
    const from = fromWallTime({ year, month: 1, day: 1, hour: 0, minute: 0 }, settings.timezone);
    const rows = await this.prisma.timeEntry.findMany({
      where: { userId, organizationId: ws.organizationId, voidedAt: null, approvalStatus: 'APPROVED', entryType: 'WORK', startTime: { gte: from, lt: until }, endTime: { not: null } },
      select: { startTime: true, endTime: true },
    });
    const workedSeconds = rows.reduce((sum, r) => sum + Math.floor((r.endTime!.getTime() - r.startTime.getTime()) / 1000), 0);
    return { agreedHours: Number(member.annualHours), workedSeconds };
  }

  async expenses(actorId: string, ws: WorkspaceContext, month: string, userId?: string): Promise<ExpenseReport> {
    const subject = await this.subject(actorId, ws, userId);
    const header = await this.header(actorId, ws, subject, month);
    const settings = await this.shifts.settings(actorId, ws);
    const [year, mon] = month.split('-').map(Number) as [number, number];
    const expenses = await this.prisma.expense.findMany({
      where: {
        userId: subject,
        organizationId: ws.organizationId,
        date: { gte: new Date(Date.UTC(year, mon - 1, 1)), lte: new Date(Date.UTC(year, mon, 0)) },
      },
      include: { location: { select: { name: true } }, customCategory: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    return { ...header, currency: settings.currency, expenses };
  }

  /** Lee una foto del almacén; si falta o falla, el informe sigue sin ella. */
  async photo(key: string | null): Promise<Buffer | null> {
    if (!key) return null;
    return this.storage.get(key).catch(() => null);
  }
}
