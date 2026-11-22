import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AbsenceDto,
  type AbsenceInput,
  type AbsenceReviewInput,
  absenceDays,
  type AbsenceTypeId,
  resolveSettings,
  type TeamCalendar,
  type VacationBalance,
} from '@hr/shared';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../common/context';
import { documentKind, KIND_MIME } from '../documents/signing';
import { NotificationsService } from '../notifications/notifications.service';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { Storage } from '../storage/storage';
import { HolidaysService } from './holidays.service';

type OrgWorkspace = Extract<WorkspaceContext, { kind: 'organization' }>;

const day = (d: string): Date => new Date(`${d}T00:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const supervises = (ws: OrgWorkspace): boolean => ws.role === 'ADMIN' || ws.role === 'MANAGER';
const sees = (ws: OrgWorkspace): boolean => supervises(ws) || ws.role === 'INSPECTOR';

const include = {
  user: { select: { id: true, fullName: true } },
  reviewedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AbsenceInclude;
type Row = Prisma.AbsenceGetPayload<{ include: typeof include }>;

/** Las vacaciones se cuentan como diga la empresa; las bajas, en días naturales; lo demás, en laborables. */
const unitFor = (type: AbsenceTypeId, vacationUnit: 'WORKING' | 'NATURAL'): 'WORKING' | 'NATURAL' =>
  type === 'VACATION' ? vacationUnit : type === 'SICK_LEAVE' ? 'NATURAL' : 'WORKING';

export interface AttachmentUpload {
  buffer: Buffer;
}

@Injectable()
export class AbsencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly holidays: HolidaysService,
    private readonly notifications: NotificationsService,
    private readonly scope: ScopeService,
  ) {}

  private org(ws: WorkspaceContext): OrgWorkspace {
    if (ws.kind !== 'organization') throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
    return ws;
  }

  private async settings(organizationId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    return resolveSettings(org.settings);
  }

  /** Turnos publicados de cada persona que caen en sus ausencias. */
  private async conflicts(organizationId: string, rows: Row[]): Promise<Map<string, number>> {
    if (!rows.length) return new Map();
    const from = rows.reduce((m, r) => (r.startDate < m ? r.startDate : m), rows[0]!.startDate);
    const to = rows.reduce((m, r) => (r.endDate > m ? r.endDate : m), rows[0]!.endDate);
    const shifts = await this.prisma.shift.findMany({
      where: { organizationId, userId: { in: [...new Set(rows.map((r) => r.userId))] }, publishedAt: { not: null }, date: { gte: from, lte: to } },
      select: { userId: true, date: true },
    });
    return new Map(rows.map((r) => [r.id, shifts.filter((s) => s.userId === r.userId && s.date >= r.startDate && s.date <= r.endDate).length]));
  }

  private async toDtos(organizationId: string, rows: Row[]): Promise<AbsenceDto[]> {
    const conflicts = await this.conflicts(organizationId, rows.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED'));
    return rows.map((r) => ({
      id: r.id,
      user: r.user,
      type: r.type,
      startDate: iso(r.startDate),
      endDate: iso(r.endDate),
      halfDay: r.halfDay,
      days: Number(r.days),
      status: r.status,
      reason: r.reason,
      hasAttachment: r.attachmentKey !== null,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt.toISOString(),
      conflictingShifts: conflicts.get(r.id) ?? 0,
    }));
  }

  /**
   * Pide una ausencia. Lo que pide un empleado queda pendiente de un responsable; lo
   * que registra un responsable (para sí o para otra persona) queda aprobado.
   */
  async create(actorId: string, workspace: WorkspaceContext, dto: AbsenceInput, attachment?: AttachmentUpload): Promise<AbsenceDto> {
    const ws = this.org(workspace);
    if (ws.role === 'INSPECTOR') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const forOther = dto.userId !== undefined && dto.userId !== actorId;
    if (forOther && !supervises(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const userId = dto.userId ?? actorId;
    if (forOther) {
      const member = await this.prisma.membership.findFirst({ where: { userId, organizationId: ws.organizationId, active: true }, select: { id: true } });
      if (!member) throw new NotFoundException({ code: 'NOT_FOUND' });
      await this.scope.assertVisible(actorId, ws, userId);
    }
    // Como mucho un año de una vez.
    if (day(dto.endDate).getTime() - day(dto.startDate).getTime() > 366 * 86_400_000) throw new BadRequestException({ code: 'INVALID_RANGE' });

    const overlap = await this.prisma.absence.findFirst({
      where: { organizationId: ws.organizationId, userId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: day(dto.endDate) }, endDate: { gte: day(dto.startDate) } },
      select: { id: true },
    });
    if (overlap) throw new ConflictException({ code: 'OVERLAP' });

    let attachmentKey: string | null = null;
    if (attachment) {
      const kind = documentKind(attachment.buffer);
      if (!kind) throw new BadRequestException({ code: 'INVALID_DOCUMENT' });
      attachmentKey = `absences/${ws.organizationId}/${randomUUID()}.${kind}`;
      await this.storage.put(attachmentKey, attachment.buffer, KIND_MIME[kind]);
    }

    const settings = await this.settings(ws.organizationId);
    const cal = await this.holidays.calendar(ws.organizationId, dto.startDate, dto.endDate);
    const days = absenceDays(dto.startDate, dto.endDate, unitFor(dto.type, settings.vacationUnit), cal.companyWide, dto.halfDay);
    const direct = supervises(ws);
    const row = await this.prisma.absence.create({
      data: {
        organizationId: ws.organizationId,
        userId,
        type: dto.type,
        startDate: day(dto.startDate),
        endDate: day(dto.endDate),
        halfDay: dto.halfDay,
        days,
        reason: dto.reason ?? null,
        attachmentKey,
        status: direct ? 'APPROVED' : 'PENDING',
        reviewedById: direct ? actorId : null,
        reviewedAt: direct ? new Date() : null,
      },
      include,
    });
    const payload = { link: '/absences', name: row.user.fullName, absenceType: row.type, from: dto.startDate, to: dto.endDate };
    if (direct && forOther) await this.notifications.notify([userId], ws.organizationId, 'ABSENCE_REVIEWED', { ...payload, approved: true });
    if (!direct) await this.notifications.notify(await this.notifications.supervisors(ws.organizationId, actorId), ws.organizationId, 'ABSENCE_PENDING', payload);
    return (await this.toDtos(ws.organizationId, [row]))[0]!;
  }

  /** Las ausencias propias que tocan el periodo. */
  async mine(actorId: string, workspace: WorkspaceContext, from: string, to: string): Promise<AbsenceDto[]> {
    const ws = this.org(workspace);
    const rows = await this.prisma.absence.findMany({
      where: { organizationId: ws.organizationId, userId: actorId, startDate: { lte: day(to) }, endDate: { gte: day(from) } },
      include,
      orderBy: { startDate: 'desc' },
    });
    return this.toDtos(ws.organizationId, rows);
  }

  /** Calendario del periodo: festivos y ausencias. Quien supervisa ve las de todo el equipo; el resto, las suyas. */
  async calendar(actorId: string, workspace: WorkspaceContext, from: string, to: string): Promise<TeamCalendar> {
    const ws = this.org(workspace);
    const [holidays, rows] = await Promise.all([
      this.holidays.list(ws.organizationId, from, to),
      this.prisma.absence.findMany({
        where: {
          organizationId: ws.organizationId,
          status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: day(to) },
          endDate: { gte: day(from) },
          ...(sees(ws) ? await this.scope.userWhere(actorId, ws) : { userId: actorId }),
        },
        include,
        orderBy: [{ startDate: 'asc' }],
      }),
    ]);
    return { holidays, absences: await this.toDtos(ws.organizationId, rows) };
  }

  async pending(actorId: string, workspace: WorkspaceContext): Promise<AbsenceDto[]> {
    const ws = this.org(workspace);
    if (!supervises(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const rows = await this.prisma.absence.findMany({
      where: { organizationId: ws.organizationId, status: 'PENDING', AND: [{ userId: { not: actorId } }, await this.scope.userWhere(actorId, ws)] },
      include,
      orderBy: { startDate: 'asc' },
    });
    return this.toDtos(ws.organizationId, rows);
  }

  /** Aprueba o rechaza. Nadie decide sobre lo suyo. Al aprobar se pueden quitar los turnos de esos días. */
  async review(actorId: string, workspace: WorkspaceContext, id: string, dto: AbsenceReviewInput): Promise<AbsenceDto> {
    const ws = this.org(workspace);
    if (!supervises(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const approve = dto.decision === 'APPROVE';
    const { count } = await this.prisma.absence.updateMany({
      where: { id, organizationId: ws.organizationId, status: 'PENDING', AND: [{ userId: { not: actorId } }, await this.scope.userWhere(actorId, ws)] },
      data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedById: actorId, reviewedAt: new Date(), rejectionReason: approve ? null : dto.reason!.trim() },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
    const row = await this.prisma.absence.findUniqueOrThrow({ where: { id }, include });
    if (approve && dto.removeShifts) {
      const { count: removed } = await this.prisma.shift.deleteMany({
        where: { organizationId: ws.organizationId, userId: row.userId, date: { gte: row.startDate, lte: row.endDate } },
      });
      if (removed) await this.notifications.notify([row.userId], ws.organizationId, 'SHIFT_UPDATED', { link: '/schedule' });
    }
    await this.notifications.notify([row.userId], ws.organizationId, 'ABSENCE_REVIEWED', {
      link: '/absences',
      approved: approve,
      absenceType: row.type,
      from: iso(row.startDate),
      to: iso(row.endDate),
    });
    return (await this.toDtos(ws.organizationId, [row]))[0]!;
  }

  /**
   * Anula una ausencia. Quien la pidió puede anularla mientras esté pendiente o, si
   * está aprobada, antes de que empiece; quien supervisa, siempre.
   */
  async cancel(actorId: string, workspace: WorkspaceContext, id: string): Promise<AbsenceDto> {
    const ws = this.org(workspace);
    const row = await this.prisma.absence.findFirst({ where: { id, organizationId: ws.organizationId }, include });
    if (!row || (row.userId !== actorId && !supervises(ws))) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (row.userId !== actorId) await this.scope.assertVisible(actorId, ws, row.userId);
    if (row.status === 'CANCELLED' || row.status === 'REJECTED') throw new ConflictException({ code: 'ABSENCE_LOCKED' });
    const settings = await this.settings(ws.organizationId);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(new Date());
    if (!supervises(ws) && row.status === 'APPROVED' && iso(row.startDate) <= today) throw new ConflictException({ code: 'ABSENCE_LOCKED' });
    const updated = await this.prisma.absence.update({ where: { id }, data: { status: 'CANCELLED' }, include });
    return (await this.toDtos(ws.organizationId, [updated]))[0]!;
  }

  async balance(actorId: string, workspace: WorkspaceContext, year: number, userId?: string): Promise<VacationBalance> {
    const ws = this.org(workspace);
    const subject = userId ?? actorId;
    if (subject !== actorId && !sees(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    if (subject !== actorId) await this.scope.assertVisible(actorId, ws, subject);
    const [settings, member, sums] = await Promise.all([
      this.settings(ws.organizationId),
      this.prisma.membership.findFirst({ where: { organizationId: ws.organizationId, userId: subject }, select: { vacationDays: true } }),
      this.prisma.absence.groupBy({
        by: ['status'],
        where: { organizationId: ws.organizationId, userId: subject, type: 'VACATION', status: { in: ['PENDING', 'APPROVED'] }, startDate: { gte: day(`${year}-01-01`), lte: day(`${year}-12-31`) } },
        _sum: { days: true },
      }),
    ]);
    if (!member) throw new NotFoundException({ code: 'NOT_FOUND' });
    const sum = (s: string): number => Number(sums.find((g) => g.status === s)?._sum.days ?? 0);
    const allowance = member.vacationDays ?? settings.vacationDays;
    const used = sum('APPROVED');
    return { year, allowance, unit: settings.vacationUnit, used, pending: sum('PENDING'), remaining: allowance - used };
  }

  async attachmentUrl(actorId: string, workspace: WorkspaceContext, id: string): Promise<{ url: string }> {
    const ws = this.org(workspace);
    const row = await this.prisma.absence.findFirst({ where: { id, organizationId: ws.organizationId }, select: { userId: true, attachmentKey: true } });
    if (!row?.attachmentKey || (row.userId !== actorId && !sees(ws))) throw new NotFoundException({ code: 'NOT_FOUND' });
    // Un justificante puede ser una baja médica: quien supervisa con departamentos solo ve los de su gente.
    if (row.userId !== actorId) await this.scope.assertVisible(actorId, workspace, row.userId);
    return { url: await this.storage.signedUrl(row.attachmentKey) };
  }

  /** Ausencias aprobadas por persona y día, para el cálculo de horas y los avisos. */
  async approvedDays(organizationId: string, userIds: string[], from: string, to: string): Promise<Map<string, Map<string, AbsenceTypeId>>> {
    const rows = await this.prisma.absence.findMany({
      where: { organizationId, userId: { in: userIds }, status: 'APPROVED', startDate: { lte: day(to) }, endDate: { gte: day(from) } },
      select: { userId: true, type: true, startDate: true, endDate: true },
    });
    const out = new Map<string, Map<string, AbsenceTypeId>>();
    for (const r of rows) {
      if (!out.has(r.userId)) out.set(r.userId, new Map());
      for (let t = r.startDate.getTime(); t <= r.endDate.getTime(); t += 86_400_000) {
        const d = new Date(t).toISOString().slice(0, 10);
        if (d >= from && d <= to) out.get(r.userId)!.set(d, r.type);
      }
    }
    return out;
  }
}
