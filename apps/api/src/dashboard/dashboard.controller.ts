import { Controller, Get } from '@nestjs/common';
import { type DashboardDto, resolveSettings } from '@hr/shared';
import { AuthUser, CurrentUser, CurrentWorkspace, WorkspaceContext } from '../common/context';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { toShiftDto } from '../shifts/shifts.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  /** Lo que pide atención ahora mismo: lo mío y, si superviso, lo de mi equipo. */
  @Get()
  async get(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<DashboardDto> {
    const organizationId = ws.organizationId;
    const now = new Date();
    const [documentsPending, nextShift] = await Promise.all([
      organizationId
        ? this.prisma.document.count({
            where: { organizationId, recipientId: user.id, OR: [{ requiresSignature: true, status: { not: 'SIGNED' } }, { requiresSignature: false, status: 'SENT' }] },
          })
        : 0,
      this.prisma.shift.findFirst({
        where: { userId: user.id, organizationId, publishedAt: { not: null }, plannedEnd: { gte: now } },
        include: { user: { select: { id: true, fullName: true } }, location: { select: { name: true, color: true } } },
        orderBy: { plannedStart: 'asc' },
      }),
    ]);
    const me = { documentsPending, nextShift: nextShift ? toShiftDto(nextShift) : null };
    if (ws.kind !== 'organization' || ws.role === 'EMPLOYEE') return { me, team: null };

    const orgId = ws.organizationId;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
    const today = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: resolveSettings(org.settings).timezone }).format(now)}T00:00:00Z`);
    // Un responsable de departamento cuenta solo a su gente.
    const mine = await this.scope.userWhere(user.id, ws);
    const [members, open, pendingEntries, pendingExpenses, documentsAwaiting, pendingAbsences, absentToday, openAlerts] = await Promise.all([
      this.prisma.membership.count({ where: { organizationId: orgId, active: true, role: { not: 'INSPECTOR' }, ...mine } }),
      this.prisma.timeEntry.findMany({ where: { organizationId: orgId, voidedAt: null, endTime: null, ...mine }, select: { entryType: true } }),
      this.prisma.timeEntry.findMany({ where: { organizationId: orgId, voidedAt: null, approvalStatus: 'PENDING', ...mine }, select: { workdayId: true }, distinct: ['workdayId'] }),
      this.prisma.expense.count({ where: { organizationId: orgId, status: 'PENDING', ...mine } }),
      // Documentos enviados que siguen sin leer o sin firmar; el responsable solo cuenta los suyos.
      this.prisma.document.count({
        where: {
          organizationId: orgId,
          ...(ws.role === 'ADMIN' ? {} : { senderId: user.id }),
          OR: [{ requiresSignature: true, status: { not: 'SIGNED' } }, { requiresSignature: false, status: 'SENT' }],
        },
      }),
      this.prisma.absence.count({ where: { organizationId: orgId, status: 'PENDING', AND: [{ userId: { not: user.id } }, mine] } }),
      this.prisma.absence.count({ where: { organizationId: orgId, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today }, ...mine } }),
      this.prisma.alert.count({ where: { organizationId: orgId, resolvedAt: null, ...mine } }),
    ]);
    return {
      me,
      team: {
        members,
        clockedIn: open.filter((o) => o.entryType === 'WORK').length,
        onBreak: open.filter((o) => o.entryType !== 'WORK').length,
        pendingTimeEntries: pendingEntries.length,
        pendingExpenses,
        documentsAwaiting,
        pendingAbsences,
        absentToday,
        openAlerts,
      },
    };
  }
}
