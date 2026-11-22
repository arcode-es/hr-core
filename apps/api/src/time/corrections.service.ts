import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  AuditEntryDto,
  AuditValues,
  ClockState,
  resolveSettings,
  ManualWorkdayInput,
  OrganizationSettings,
  ReviewInput,
  ReviewItem,
  TeamDayRow,
  WorkdayDto,
} from '@hr/shared';
import { ApprovalStatus, Prisma, TimeEntry } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { RequestMeta, WorkspaceContext } from '../common/context';
import { ScopeService } from '../common/scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvalidRangeError, planSegments, PlannedSegment } from './manual';
import { groupWorkdays, toWorkday, withLocation } from './mappers';

type Tx = Prisma.TransactionClient;

const snapshot = (e: Pick<TimeEntry, 'entryType' | 'startTime' | 'endTime' | 'approvalStatus' | 'voidedAt'>): AuditValues => ({
  entryType: e.entryType,
  startTime: e.startTime.toISOString(),
  endTime: e.endTime?.toISOString() ?? null,
  approvalStatus: e.approvalStatus,
  voided: e.voidedAt !== null,
});

const isSupervisor = (ws: WorkspaceContext): boolean => ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');

/**
 * Fichaje declarativo y correcciones. Regla de oro: nada se sobrescribe.
 * Corregir una jornada anula sus tramos (voided_at) y crea otros nuevos; cada
 * paso deja una fila en time_entry_audits con autor, valores y motivo.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly scope: ScopeService,
  ) {}

  // ── Crear y corregir ───────────────────────────────────────────────────

  /** Jornada introducida a mano. `replaces` la convierte en corrección de una existente. */
  async submit(
    actorId: string,
    ws: WorkspaceContext,
    dto: ManualWorkdayInput,
    meta: RequestMeta,
    replaces?: string,
  ): Promise<WorkdayDto> {
    if (ws.kind === 'organization' && ws.role === 'INSPECTOR') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });

    let segments: PlannedSegment[];
    try {
      segments = planSegments(dto, new Date());
    } catch (e) {
      if (e instanceof InvalidRangeError) throw new BadRequestException({ code: 'INVALID_RANGE' });
      throw e;
    }
    const start = segments[0]!.startTime;
    const end = segments[segments.length - 1]!.endTime;

    const workday = await this.prisma.$transaction(async (tx) => {
      let userId = dto.userId ?? actorId;
      const original = replaces ? await this.loadWorkday(tx, ws, replaces) : null;
      if (original) {
        if (original.some((e) => e.endTime === null)) throw new ConflictException({ code: 'WORKDAY_OPEN' });
        userId = original[0]!.userId;
        const pending = await tx.timeEntry.count({ where: { replacesWorkdayId: replaces, approvalStatus: 'PENDING', voidedAt: null } });
        if (pending) throw new ConflictException({ code: 'CORRECTION_PENDING' });
      }

      const forOther = userId !== actorId;
      if (forOther) {
        if (!isSupervisor(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
        await this.scope.assertVisible(actorId, ws, userId);
        const member = await tx.membership.findFirst({ where: { userId, organizationId: ws.organizationId!, active: true } });
        if (!member) throw new NotFoundException({ code: 'NOT_FOUND' });
      } else if (ws.kind === 'organization' && ws.role === 'EMPLOYEE') {
        const org = await tx.organization.findUniqueOrThrow({ where: { id: ws.organizationId }, select: { settings: true } });
        const settings = resolveSettings(org.settings);
        if (!settings.allowEmployeeManualEntries) throw new ForbiddenException({ code: 'MANUAL_NOT_ALLOWED' });
      }

      if (dto.locationId) {
        const location = await tx.location.findFirst({
          where: { id: dto.locationId, ...(ws.kind === 'organization' ? { organizationId: ws.organizationId } : { organizationId: null, userId }) },
          select: { id: true },
        });
        if (!location) throw new NotFoundException({ code: 'NOT_FOUND' });
      }

      // No puede pisar otro registro vigente o pendiente (salvo la jornada que corrige).
      const overlap = await tx.timeEntry.count({
        where: {
          userId,
          organizationId: ws.organizationId,
          voidedAt: null,
          approvalStatus: { not: 'REJECTED' },
          ...(replaces ? { workdayId: { not: replaces } } : {}),
          startTime: { lt: end },
          OR: [{ endTime: null }, { endTime: { gt: start } }],
        },
      });
      if (overlap) throw new ConflictException({ code: 'OVERLAP' });

      // En una empresa, lo que declara un empleado lo valida su responsable.
      const needsReview = ws.kind === 'organization' && ws.role === 'EMPLOYEE';
      const status: ApprovalStatus = needsReview ? 'PENDING' : 'APPROVED';
      const applyNow = !!original && !needsReview;
      const now = new Date();

      if (applyNow) await this.voidEntries(tx, original, actorId, dto.reason, meta, now);

      // Aplicada: ocupa el lugar de la original. Propuesta: jornada aparte hasta que se valide.
      const workdayId = applyNow ? replaces! : randomUUID();
      const created = await Promise.all(
        segments.map((s) =>
          tx.timeEntry.create({
            data: {
              userId,
              organizationId: ws.organizationId,
              workdayId,
              entryType: s.entryType,
              breakKind: s.breakKind,
              startTime: s.startTime,
              endTime: s.endTime,
              locationId: dto.locationId ?? null,
              origin: 'MANUAL',
              approvalStatus: status,
              replacesWorkdayId: original && needsReview ? replaces! : null,
              ...(status === 'APPROVED' && forOther ? { reviewedById: actorId, reviewedAt: now } : {}),
            },
            include: withLocation,
          }),
        ),
      );
      await this.audit(tx, created, original ? 'CREATE_CORRECTION' : 'CREATE_MANUAL', actorId, dto.reason, meta, () => null);
      return toWorkday(created.sort((a, b) => a.startTime.getTime() - b.startTime.getTime()), now);
    });

    if (workday.approvalStatus === 'PENDING' && ws.kind === 'organization') {
      const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { fullName: true } });
      await this.notifications.notify(await this.notifications.supervisors(ws.organizationId, actorId), ws.organizationId, 'TIME_ENTRY_PENDING', {
        link: '/timesheets',
        name: actor.fullName,
      });
    }
    return workday;
  }

  /**
   * Corrige una jornada cerrada. Solo su autor o quien supervisa la empresa;
   * un empleado no puede tocar la jornada de un compañero.
   */
  async submitCorrection(actorId: string, ws: WorkspaceContext, workdayId: string, dto: ManualWorkdayInput, meta: RequestMeta): Promise<WorkdayDto> {
    const owner = await this.prisma.timeEntry.findFirst({
      where: { organizationId: ws.organizationId, workdayId, voidedAt: null, approvalStatus: 'APPROVED' },
      select: { userId: true },
    });
    if (!owner || (owner.userId !== actorId && !isSupervisor(ws))) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (owner.userId !== actorId) await this.scope.assertVisible(actorId, ws, owner.userId);
    return this.submit(actorId, ws, { ...dto, userId: owner.userId }, meta, workdayId);
  }

  // ── Validación ─────────────────────────────────────────────────────────

  async pending(actorId: string, ws: WorkspaceContext): Promise<ReviewItem[]> {
    const now = new Date();
    const entries = await this.prisma.timeEntry.findMany({
      where: { organizationId: ws.organizationId, approvalStatus: 'PENDING', voidedAt: null, ...(await this.scope.userWhere(actorId, ws)) },
      include: { ...withLocation, user: { select: { id: true, fullName: true } }, audits: { orderBy: { changedAt: 'asc' }, take: 1 } },
      orderBy: { startTime: 'asc' },
    });
    const proposals = groupWorkdays(entries, now);
    const originalIds = [...new Set(proposals.flatMap((p) => (p.replacesWorkdayId ? [p.replacesWorkdayId] : [])))];
    const originals = groupWorkdays(
      await this.prisma.timeEntry.findMany({
        where: { organizationId: ws.organizationId, workdayId: { in: originalIds }, voidedAt: null, approvalStatus: 'APPROVED' },
        include: withLocation,
        orderBy: { startTime: 'asc' },
      }),
      now,
    );
    return proposals.map((proposal) => {
      const first = entries.find((e) => e.workdayId === proposal.id)!;
      return {
        user: first.user,
        proposal,
        original: originals.find((o) => o.id === proposal.replacesWorkdayId) ?? null,
        reason: first.audits[0]?.reason ?? '',
        requestedAt: first.createdAt.toISOString(),
      };
    });
  }

  /** Aprueba o rechaza una jornada pendiente. Nadie valida sus propios registros. */
  async review(actorId: string, ws: WorkspaceContext, workdayId: string, dto: ReviewInput, meta: RequestMeta): Promise<void> {
    const ownerId = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.timeEntry.findMany({
        where: { organizationId: ws.organizationId, workdayId, approvalStatus: 'PENDING', voidedAt: null },
      });
      if (!proposal.length) throw new NotFoundException({ code: 'NOT_FOUND' });
      if (proposal[0]!.userId === actorId) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
      await this.scope.assertVisible(actorId, ws, proposal[0]!.userId);

      const now = new Date();
      const approve = dto.decision === 'APPROVE';
      const reason = dto.reason?.trim() || 'Aprobado';
      const replaces = proposal[0]!.replacesWorkdayId;

      if (approve && replaces) {
        const original = await tx.timeEntry.findMany({ where: { organizationId: ws.organizationId, workdayId: replaces, voidedAt: null } });
        await this.voidEntries(tx, original, actorId, reason, meta, now);
      }

      const status: ApprovalStatus = approve ? 'APPROVED' : 'REJECTED';
      await tx.timeEntry.updateMany({
        where: { id: { in: proposal.map((e) => e.id) } },
        data: {
          approvalStatus: status,
          reviewedById: actorId,
          reviewedAt: now,
          rejectionReason: approve ? null : reason,
          // Aprobada, la corrección pasa a ser la jornada: hereda su identificador.
          ...(approve && replaces ? { workdayId: replaces, replacesWorkdayId: null } : {}),
        },
      });
      await this.audit(tx, proposal, approve ? 'APPROVE' : 'REJECT', actorId, reason, meta, snapshot, (e) => ({
        ...snapshot(e),
        approvalStatus: status,
      }));
      return proposal[0]!.userId;
    });
    await this.notifications.notify([ownerId], ws.organizationId, 'TIME_ENTRY_REVIEWED', { link: '/clock', approved: dto.decision === 'APPROVE' });
  }

  // ── Consulta ───────────────────────────────────────────────────────────

  /** Fichajes del equipo en un intervalo: una fila por miembro activo, haya fichado o no. */
  async teamDay(actorId: string, ws: WorkspaceContext, from: Date, to: Date): Promise<TeamDayRow[]> {
    const organizationId = ws.organizationId!;
    const now = new Date();
    const visible = await this.scope.userWhere(actorId, ws);
    const [members, entries, open] = await Promise.all([
      this.prisma.membership.findMany({
        where: { organizationId, active: true, role: { not: 'INSPECTOR' }, ...visible },
        select: { user: { select: { id: true, fullName: true } } },
        orderBy: { user: { fullName: 'asc' } },
      }),
      this.prisma.timeEntry.findMany({
        where: { organizationId, voidedAt: null, approvalStatus: { not: 'REJECTED' }, startTime: { gte: from, lt: to } },
        include: withLocation,
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.timeEntry.findMany({
        where: { organizationId, voidedAt: null, endTime: null },
        select: { userId: true, entryType: true },
      }),
    ]);
    return members.map(({ user }) => {
      const current = open.find((o) => o.userId === user.id);
      const state: ClockState = !current ? 'IDLE' : current.entryType === 'WORK' ? 'WORKING' : 'PAUSED';
      return { user, state, workdays: groupWorkdays(entries.filter((e) => e.userId === user.id), now) };
    });
  }

  /** Historial de cambios de una jornada, incluidos los tramos anulados y las propuestas rechazadas. */
  async auditTrail(actorId: string, ws: WorkspaceContext, workdayId: string): Promise<AuditEntryDto[]> {
    const canSupervise = ws.kind === 'organization' && ws.role !== 'EMPLOYEE';
    if (canSupervise) {
      // Quien supervisa con departamentos asignados solo ve el historial de su gente.
      const owner = await this.prisma.timeEntry.findFirst({
        where: { organizationId: ws.organizationId, OR: [{ workdayId }, { replacesWorkdayId: workdayId }] },
        select: { userId: true },
      });
      if (owner && owner.userId !== actorId) await this.scope.assertVisible(actorId, ws, owner.userId);
    }
    const rows = await this.prisma.timeEntryAudit.findMany({
      where: {
        timeEntry: {
          organizationId: ws.organizationId,
          OR: [{ workdayId }, { replacesWorkdayId: workdayId }],
          ...(canSupervise ? {} : { userId: actorId }),
        },
      },
      include: { changedBy: { select: { id: true, fullName: true } } },
      orderBy: { changedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      action: r.action as AuditAction,
      changedBy: r.changedBy,
      changedAt: r.changedAt.toISOString(),
      reason: r.reason,
      oldValues: r.oldValues as AuditValues | null,
      newValues: r.newValues as AuditValues | null,
    }));
  }

  // ── Internos ───────────────────────────────────────────────────────────

  /** Tramos vigentes de una jornada que el actor puede corregir: suya, o de su equipo si supervisa. */
  private async loadWorkday(tx: Tx, ws: WorkspaceContext, workdayId: string): Promise<TimeEntry[]> {
    const entries = await tx.timeEntry.findMany({
      where: { organizationId: ws.organizationId, workdayId, voidedAt: null, approvalStatus: 'APPROVED' },
    });
    if (!entries.length) throw new NotFoundException({ code: 'NOT_FOUND' });
    return entries;
  }

  private async voidEntries(tx: Tx, entries: TimeEntry[], actorId: string, reason: string, meta: RequestMeta, now: Date): Promise<void> {
    await tx.timeEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) } }, data: { voidedAt: now } });
    await this.audit(tx, entries, 'VOID', actorId, reason, meta, snapshot, (e) => ({ ...snapshot(e), voided: true }));
  }

  private async audit(
    tx: Tx,
    entries: TimeEntry[],
    action: AuditAction,
    actorId: string,
    reason: string,
    meta: RequestMeta,
    oldValues: (e: TimeEntry) => AuditValues | null,
    newValues: (e: TimeEntry) => AuditValues = snapshot,
  ): Promise<void> {
    await tx.timeEntryAudit.createMany({
      data: entries.map((e) => ({
        timeEntryId: e.id,
        changedByUserId: actorId,
        action,
        reason,
        oldValues: (oldValues(e) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        newValues: newValues(e) as Prisma.InputJsonValue,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      })),
    });
  }
}
