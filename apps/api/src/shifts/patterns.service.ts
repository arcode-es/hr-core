import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type ApplyPatternInput, type ApplyPatternResult, datesBetween, type PatternDay, resolveSettings, type ShiftPatternDto, type ShiftPatternInput } from '@hr/shared';
import { Prisma } from '@prisma/client';
import { AbsencesService } from '../absences/absences.service';
import { HolidaysService } from '../absences/holidays.service';
import type { WorkspaceContext } from '../common/context';
import { ScopeService } from '../common/scope.service';
import { fromWallTime, parseClock } from '../common/tz';
import { PrismaService } from '../prisma/prisma.service';

const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Inicio y fin de un día del patrón en hora local; si termina antes de empezar, es de noche y acaba al día siguiente. */
export function patternInstants(date: string, day: NonNullable<PatternDay>, timezone: string): { start: Date; end: Date } {
  const [year, month, d] = date.split('-').map(Number) as [number, number, number];
  const s = parseClock(day.start);
  const e = parseClock(day.end);
  const overnight = e.hour * 60 + e.minute <= s.hour * 60 + s.minute;
  return {
    start: fromWallTime({ year, month, day: d, ...s }, timezone),
    end: fromWallTime({ year, month, day: d + (overnight ? 1 : 0), ...e }, timezone),
  };
}

/**
 * Turnos rotativos: un patrón es un ciclo de N días (cada uno con turno o libre).
 * Aplicarlo crea borradores en el cuadrante para varias personas, cada una con su
 * desfase, a la hora local correcta aunque haya cambio de hora, saltándose los
 * festivos, las ausencias aprobadas y lo que ya tenga turno.
 */
@Injectable()
export class ShiftPatternsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly holidays: HolidaysService,
    private readonly absences: AbsencesService,
  ) {}

  private planner(ws: WorkspaceContext): string {
    if (ws.kind !== 'organization') throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
    if (ws.role !== 'ADMIN' && ws.role !== 'MANAGER') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    return ws.organizationId;
  }

  async list(ws: WorkspaceContext): Promise<ShiftPatternDto[]> {
    const rows = await this.prisma.shiftPattern.findMany({ where: { organizationId: this.planner(ws) }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, name: r.name, days: r.days as PatternDay[] }));
  }

  async create(ws: WorkspaceContext, dto: ShiftPatternInput): Promise<ShiftPatternDto> {
    const organizationId = this.planner(ws);
    const locationIds = [...new Set(dto.days.flatMap((d) => (d?.locationId ? [d.locationId] : [])))];
    if (locationIds.length) {
      const found = await this.prisma.location.count({ where: { id: { in: locationIds }, organizationId } });
      if (found !== locationIds.length) throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    try {
      const row = await this.prisma.shiftPattern.create({ data: { organizationId, name: dto.name, days: dto.days as Prisma.InputJsonValue } });
      return { id: row.id, name: row.name, days: row.days as PatternDay[] };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'PATTERN_EXISTS' });
      throw e;
    }
  }

  async remove(ws: WorkspaceContext, id: string): Promise<void> {
    const { count } = await this.prisma.shiftPattern.deleteMany({ where: { id, organizationId: this.planner(ws) } });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  async apply(actorId: string, ws: WorkspaceContext, id: string, dto: ApplyPatternInput): Promise<ApplyPatternResult> {
    const organizationId = this.planner(ws);
    const pattern = await this.prisma.shiftPattern.findFirst({ where: { id, organizationId } });
    if (!pattern) throw new NotFoundException({ code: 'NOT_FOUND' });
    const days = pattern.days as PatternDay[];
    const userIds = [...new Set(dto.userIds)];
    const members = await this.prisma.membership.count({ where: { organizationId, active: true, role: { not: 'INSPECTOR' }, userId: { in: userIds } } });
    if (members !== userIds.length) throw new BadRequestException({ code: 'VALIDATION' });
    for (const u of userIds) await this.scope.assertVisible(actorId, ws, u);

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const { timezone } = resolveSettings(org.settings);
    const first = dto.startDate;
    const last = addDays(first, dto.weeks * 7 - 1);
    const dates = datesBetween(first, last);
    const [calendar, absent, existing] = await Promise.all([
      this.holidays.calendar(organizationId, first, last),
      this.absences.approvedDays(organizationId, userIds, first, last),
      this.prisma.shift.findMany({
        where: { organizationId, userId: { in: userIds }, plannedStart: { lt: new Date(Date.parse(`${last}T00:00:00Z`) + 2 * 86_400_000) }, plannedEnd: { gt: new Date(Date.parse(`${first}T00:00:00Z`) - 86_400_000) } },
        select: { userId: true, plannedStart: true, plannedEnd: true },
      }),
    ]);

    const skipped = { holiday: 0, absence: 0, overlap: 0 };
    const data: Prisma.ShiftCreateManyInput[] = [];
    userIds.forEach((userId, person) => {
      dates.forEach((date, i) => {
        const day = days[(i + person * dto.stagger) % days.length];
        if (!day) return;
        if (calendar.isHoliday(date, day.locationId ?? null)) return void skipped.holiday++;
        if (absent.get(userId)?.has(date)) return void skipped.absence++;
        const { start, end } = patternInstants(date, day, timezone);
        if (existing.some((s) => s.userId === userId && s.plannedStart < end && s.plannedEnd > start)) return void skipped.overlap++;
        data.push({
          organizationId,
          userId,
          locationId: day.locationId ?? null,
          date: new Date(`${date}T00:00:00Z`),
          plannedStart: start,
          plannedEnd: end,
          breakMinutes: day.breakMinutes,
          notes: pattern.name,
          createdById: actorId,
          publishedAt: null,
        });
      });
    });
    if (data.length) await this.prisma.shift.createMany({ data });
    return { created: data.length, skipped };
  }
}
