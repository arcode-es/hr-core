import { ForbiddenException, Injectable } from '@nestjs/common';
import { type AbsenceTypeId, datesBetween, isWeekend, type UserHours } from '@hr/shared';
import { AbsencesService } from '../absences/absences.service';
import { type HolidayCalendar, HolidaysService } from '../absences/holidays.service';
import type { WorkspaceContext } from '../common/context';
import { ScopeService } from '../common/scope.service';
import { localDate } from '../common/tz';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftsService } from '../shifts/shifts.service';
import { computeBags } from './bags';

@Injectable()
export class HoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: ShiftsService,
    private readonly holidays: HolidaysService,
    private readonly absences: AbsencesService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * Bolsas de horas del periodo. Solo cuentan los tramos vigentes y aprobados:
   * ni pendientes de validar, ni rechazados, ni anulados. Lo planificado sale
   * de los turnos publicados.
   */
  async summary(actorId: string, ws: WorkspaceContext, from: Date, to: Date, team: boolean): Promise<UserHours[]> {
    if (team && (ws.kind !== 'organization' || ws.role === 'EMPLOYEE')) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const settings = await this.shifts.settings(actorId, ws);

    const people = team
      ? (
          await this.prisma.membership.findMany({
            where: { organizationId: ws.organizationId!, active: true, role: { not: 'INSPECTOR' }, ...(await this.scope.userWhere(actorId, ws)) },
            select: { user: { select: { id: true, fullName: true } } },
            orderBy: { user: { fullName: 'asc' } },
          })
        ).map((m) => m.user)
      : [await this.prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, fullName: true } })];
    const userIds = people.map((p) => p.id);

    const [entries, shifts] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: {
          organizationId: ws.organizationId,
          userId: { in: userIds },
          voidedAt: null,
          approvalStatus: 'APPROVED',
          startTime: { gte: from, lt: to },
        },
        select: { userId: true, workdayId: true, entryType: true, startTime: true, endTime: true },
      }),
      this.prisma.shift.findMany({
        where: { organizationId: ws.organizationId, userId: { in: userIds }, publishedAt: { not: null }, plannedStart: { gte: from, lt: to } },
        select: { userId: true, date: true, plannedStart: true, plannedEnd: true, breakMinutes: true, locationId: true },
      }),
    ]);

    // Festivos y ausencias aprobadas del periodo (en días locales de la empresa).
    const first = localDate(from, settings.timezone);
    const last = localDate(new Date(to.getTime() - 1), settings.timezone);
    const calendar: HolidayCalendar | null = ws.kind === 'organization' ? await this.holidays.calendar(ws.organizationId, first, last) : null;
    const absent = ws.kind === 'organization' ? await this.absences.approvedDays(ws.organizationId, userIds, first, last) : new Map<string, Map<string, AbsenceTypeId>>();
    const workingDays = datesBetween(first, last).filter((d) => !isWeekend(d));

    const now = new Date();
    return people.map((user) => {
      const mine = absent.get(user.id) ?? new Map<string, AbsenceTypeId>();
      const absenceDays: Partial<Record<AbsenceTypeId, number>> = {};
      for (const [date, type] of mine) {
        // Las bajas se cuentan en días naturales; el resto, en laborables.
        if (type !== 'SICK_LEAVE' && (isWeekend(date) || calendar?.companyWide.has(date))) continue;
        absenceDays[type] = (absenceDays[type] ?? 0) + 1;
      }
      return {
        user,
        ...computeBags(
          entries.filter((e) => e.userId === user.id),
          shifts.filter((s) => s.userId === user.id).map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) })),
          settings,
          now,
          (date, locationId) => (mine.has(date) ? 'absence' : calendar?.isHoliday(date, locationId) ? 'holiday' : null),
        ),
        absenceDays,
        holidays: workingDays.filter((d) => calendar?.companyWide.has(d)).length,
      };
    });
  }
}
