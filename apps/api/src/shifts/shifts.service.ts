import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CopyShiftsInput,
  resolveSettings,
  OrganizationSettings,
  ShiftDto,
  ShiftInput,
  UpdateShiftInput,
} from '@hr/shared';
import { Prisma, Shift } from '@prisma/client';
import type { WorkspaceContext } from '../common/context';
import { addDaysKeepingWallTime, localDate } from '../common/tz';
import { NotificationsService } from '../notifications/notifications.service';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;
type ShiftRow = Shift & { user: { id: string; fullName: string }; location: { name: string; color: string | null } | null };

const include = {
  user: { select: { id: true, fullName: true } },
  location: { select: { name: true, color: true } },
} satisfies Prisma.ShiftInclude;

const MAX_SHIFT_MS = 24 * 3600_000;

export const toShiftDto = (s: ShiftRow): ShiftDto => ({
  id: s.id,
  user: s.user,
  date: s.date.toISOString().slice(0, 10),
  plannedStart: s.plannedStart.toISOString(),
  plannedEnd: s.plannedEnd.toISOString(),
  breakMinutes: s.breakMinutes,
  locationId: s.locationId,
  locationName: s.location?.name ?? null,
  locationColor: s.location?.color ?? null,
  notes: s.notes,
  published: s.publishedAt !== null,
});

const canPlan = (ws: WorkspaceContext): boolean => ws.kind === 'personal' || ws.role === 'ADMIN' || ws.role === 'MANAGER';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly scope: ScopeService,
  ) {}

  /** Ajustes del espacio: los de la empresa, o los del usuario en su espacio personal. */
  async settings(userId: string, ws: WorkspaceContext): Promise<OrganizationSettings> {
    if (ws.kind === 'organization') {
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: ws.organizationId }, select: { settings: true } });
      return resolveSettings(org.settings);
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    return { ...resolveSettings({}), timezone: user.timezone };
  }

  /** Quien planifica ve todo, borradores incluidos; el resto, solo sus turnos publicados. */
  async list(userId: string, ws: WorkspaceContext, from: Date, to: Date): Promise<ShiftDto[]> {
    const supervises = ws.kind === 'organization' && ws.role !== 'EMPLOYEE';
    const rows = await this.prisma.shift.findMany({
      where: {
        organizationId: ws.organizationId,
        plannedStart: { gte: from, lt: to },
        ...(ws.kind === 'personal' ? { userId } : supervises ? await this.scope.userWhere(userId, ws) : { userId, publishedAt: { not: null } }),
      },
      include,
      orderBy: [{ plannedStart: 'asc' }],
    });
    return rows.map(toShiftDto);
  }

  async create(actorId: string, ws: WorkspaceContext, inputs: ShiftInput[]): Promise<ShiftDto[]> {
    if (!canPlan(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const { timezone } = await this.settings(actorId, ws);
    return this.prisma.$transaction(async (tx) => {
      const created: ShiftRow[] = [];
      for (const input of inputs) {
        const start = new Date(input.start);
        const end = new Date(input.end);
        this.assertRange(start, end, input.breakMinutes);
        await this.assertAssignable(tx, actorId, ws, input.userId, input.locationId ?? null);
        await this.assertFree(tx, ws, input.userId, start, end);
        created.push(
          await tx.shift.create({
            data: {
              organizationId: ws.organizationId,
              userId: input.userId,
              locationId: input.locationId ?? null,
              date: new Date(`${localDate(start, timezone)}T00:00:00Z`),
              plannedStart: start,
              plannedEnd: end,
              breakMinutes: input.breakMinutes,
              notes: input.notes ?? null,
              createdById: actorId,
              // En el espacio personal no hay a quién publicar: el turno es visible desde el principio.
              publishedAt: ws.kind === 'personal' ? new Date() : null,
            },
            include,
          }),
        );
      }
      return created.map(toShiftDto);
    });
  }

  async update(actorId: string, ws: WorkspaceContext, id: string, input: UpdateShiftInput): Promise<ShiftDto> {
    if (!canPlan(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const { timezone } = await this.settings(actorId, ws);
    const { dto, notifyUserId } = await this.prisma.$transaction(async (tx) => {
      const shift = await this.owned(tx, actorId, ws, id);
      const start = new Date(input.start);
      const end = new Date(input.end);
      this.assertRange(start, end, input.breakMinutes);
      await this.assertAssignable(tx, actorId, ws, shift.userId, input.locationId ?? null);
      await this.assertFree(tx, ws, shift.userId, start, end, id);
      const row = await tx.shift.update({
        where: { id },
        data: {
          locationId: input.locationId ?? null,
          date: new Date(`${localDate(start, timezone)}T00:00:00Z`),
          plannedStart: start,
          plannedEnd: end,
          breakMinutes: input.breakMinutes,
          notes: input.notes ?? null,
        },
        include,
      });
      // Solo se avisa de cambios en turnos que el empleado ya veía.
      return { dto: toShiftDto(row), notifyUserId: shift.publishedAt && shift.userId !== actorId ? shift.userId : null };
    });
    if (notifyUserId) await this.notifications.notify([notifyUserId], ws.organizationId, 'SHIFT_UPDATED', { link: '/schedule' });
    return dto;
  }

  /** Un turno es planificación, no registro legal: se puede borrar. Los fichajes ya hechos se conservan. */
  async remove(actorId: string, ws: WorkspaceContext, id: string): Promise<void> {
    if (!canPlan(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const shift = await this.prisma.$transaction(async (tx) => {
      const found = await this.owned(tx, actorId, ws, id);
      await tx.shift.delete({ where: { id } });
      return found;
    });
    if (shift.publishedAt && shift.userId !== actorId) await this.notifications.notify([shift.userId], ws.organizationId, 'SHIFT_UPDATED', { link: '/schedule' });
  }

  /** Publica los borradores del intervalo. Devuelve cuántos turnos pasan a ser visibles. */
  async publish(actorId: string, ws: WorkspaceContext, from: Date, to: Date): Promise<{ published: number }> {
    const where = { organizationId: ws.organizationId, publishedAt: null, plannedStart: { gte: from, lt: to }, ...(await this.scope.userWhere(actorId, ws)) };
    const drafts = await this.prisma.shift.findMany({ where, select: { id: true, userId: true } });
    const { count } = await this.prisma.shift.updateMany({ where: { id: { in: drafts.map((d) => d.id) }, publishedAt: null }, data: { publishedAt: new Date() } });
    // Un aviso por persona con cuántos turnos nuevos tiene.
    const perUser = new Map<string, number>();
    for (const d of drafts) if (d.userId !== actorId) perUser.set(d.userId, (perUser.get(d.userId) ?? 0) + 1);
    await Promise.all([...perUser].map(([userId, n]) => this.notifications.notify([userId], ws.organizationId, 'SHIFT_PUBLISHED', { link: '/schedule', count: n })));
    return { published: count };
  }

  /**
   * Copia los turnos de un intervalo a otra fecha conservando la hora local
   * (también a través de un cambio de hora). Los que chocarían con un turno
   * existente de la misma persona se omiten.
   */
  async copy(actorId: string, ws: WorkspaceContext, dto: CopyShiftsInput): Promise<{ copied: number; skipped: number }> {
    if (!canPlan(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const { timezone } = await this.settings(actorId, ws);
    const visible = await this.scope.userWhere(actorId, ws);
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.shift.findMany({
        where: {
          organizationId: ws.organizationId,
          ...(ws.kind === 'personal' ? { userId: actorId } : visible),
          plannedStart: { gte: new Date(dto.from), lt: new Date(dto.to) },
        },
        orderBy: { plannedStart: 'asc' },
      });
      let copied = 0;
      for (const s of source) {
        const start = addDaysKeepingWallTime(s.plannedStart, dto.offsetDays, timezone);
        const end = addDaysKeepingWallTime(s.plannedEnd, dto.offsetDays, timezone);
        if (await this.overlaps(tx, ws, s.userId, start, end)) continue;
        // Solo se copia a quien sigue en el equipo.
        if (ws.kind === 'organization') {
          const member = await tx.membership.count({ where: { userId: s.userId, organizationId: ws.organizationId, active: true } });
          if (!member) continue;
        }
        await tx.shift.create({
          data: {
            organizationId: s.organizationId,
            userId: s.userId,
            locationId: s.locationId,
            date: new Date(`${localDate(start, timezone)}T00:00:00Z`),
            plannedStart: start,
            plannedEnd: end,
            breakMinutes: s.breakMinutes,
            notes: s.notes,
            createdById: actorId,
            publishedAt: ws.kind === 'personal' ? new Date() : null,
          },
        });
        copied++;
      }
      return { copied, skipped: source.length - copied };
    });
  }

  /**
   * Turno publicado que corresponde a un instante: el que está en curso o, si
   * no, el que empieza en las próximas horas (quien llega pronto ficha contra su turno).
   */
  async current(userId: string, ws: WorkspaceContext, at: Date, leadHours = 3): Promise<ShiftRow | null> {
    return this.prisma.shift.findFirst({
      where: {
        userId,
        organizationId: ws.organizationId,
        publishedAt: { not: null },
        plannedStart: { lte: new Date(at.getTime() + leadHours * 3600_000) },
        plannedEnd: { gte: at },
      },
      include,
      orderBy: { plannedStart: 'asc' },
    });
  }

  // ── Internos ───────────────────────────────────────────────────────────

  private assertRange(start: Date, end: Date, breakMinutes: number): void {
    const ms = end.getTime() - start.getTime();
    if (!(ms > 0) || ms > MAX_SHIFT_MS || breakMinutes * 60_000 >= ms) throw new BadRequestException({ code: 'INVALID_RANGE' });
  }

  private async owned(tx: Tx, actorId: string, ws: WorkspaceContext, id: string): Promise<Shift> {
    const shift = await tx.shift.findFirst({
      where: { id, organizationId: ws.organizationId, ...(ws.kind === 'personal' ? { userId: actorId } : {}) },
    });
    if (!shift) throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.scope.assertVisible(actorId, ws, shift.userId);
    return shift;
  }

  private async assertAssignable(tx: Tx, actorId: string, ws: WorkspaceContext, userId: string, locationId: string | null): Promise<void> {
    if (ws.kind === 'personal') {
      if (userId !== actorId) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    } else {
      const member = await tx.membership.findFirst({
        where: { userId, organizationId: ws.organizationId, active: true, role: { not: 'INSPECTOR' } },
        select: { id: true },
      });
      if (!member) throw new NotFoundException({ code: 'NOT_FOUND' });
      await this.scope.assertVisible(actorId, ws, userId);
    }
    if (locationId) {
      const location = await tx.location.findFirst({
        where: { id: locationId, ...(ws.kind === 'organization' ? { organizationId: ws.organizationId } : { organizationId: null, userId }) },
        select: { id: true },
      });
      if (!location) throw new NotFoundException({ code: 'NOT_FOUND' });
    }
  }

  private async overlaps(tx: Tx, ws: WorkspaceContext, userId: string, start: Date, end: Date, exceptId?: string): Promise<boolean> {
    const count = await tx.shift.count({
      where: {
        userId,
        organizationId: ws.organizationId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        plannedStart: { lt: end },
        plannedEnd: { gt: start },
      },
    });
    return count > 0;
  }

  private async assertFree(tx: Tx, ws: WorkspaceContext, userId: string, start: Date, end: Date, exceptId?: string): Promise<void> {
    if (await this.overlaps(tx, ws, userId, start, end, exceptId)) throw new ConflictException({ code: 'OVERLAP' });
  }
}
