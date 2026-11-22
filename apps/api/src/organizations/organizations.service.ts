import { BadRequestException, ConflictException, ForbiddenException, GoneException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateInvitationInput,
  type ImportInvitationsInput,
  type ImportPreview,
  type ImportResult,
  CreateOrganizationInput,
  DEFAULT_ORGANIZATION_SETTINGS,
  InvitationDto,
  InvitationPreview,
  MemberDto,
  OrganizationDto,
  OrganizationSettingsInput,
  resolveSettings,
  UpdateMemberInput,
  WorkspaceSummary,
} from '@hr/shared';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashToken } from '../auth/auth.service';
import type { WorkspaceContext } from '../common/context';
import { ScopeService } from '../common/scope.service';
import type { Env } from '../config/env';
import { isDemoAccount } from '../demo/accounts';
import { Deployment } from '../deployment/deployment';
import { sendManual } from '../mail/manuals';
import { MailService } from '../mail/mail.service';
import { invitationEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { Storage } from '../storage/storage';
import { logoKind } from './branding';
import { readImport, UnreadableImportError } from './import';

const INVITATION_DAYS = 7;
/** Las invitaciones aceptadas o caducadas se siguen listando un tiempo, para ver su estado. */
const INVITATION_HISTORY_DAYS = 60;
/** Entre dos reenvíos a la misma persona. */
const RESEND_COOLDOWN_MS = 60_000;

type InvitationRow = Prisma.InvitationGetPayload<{ include: { department: { select: { name: true } } } }>;

const invitationDto = (i: InvitationRow, now = new Date()): InvitationDto => ({
  id: i.id,
  email: i.email,
  role: i.role,
  fullName: i.fullName,
  department: i.department?.name ?? null,
  status: i.acceptedAt ? 'ACCEPTED' : i.expiresAt < now ? 'EXPIRED' : 'PENDING',
  sendCount: i.sendCount,
  lastSentAt: i.lastSentAt.toISOString(),
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
});
const ROLE_ES = { ADMIN: 'administrador/a', MANAGER: 'responsable', EMPLOYEE: 'empleado/a', INSPECTOR: 'inspección o representación legal (solo consulta)' } as const;
const ROLE_EN = { ADMIN: 'admin', MANAGER: 'manager', EMPLOYEE: 'employee', INSPECTOR: 'inspector or worker representative (read only)' } as const;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly deployment: Deployment,
    private readonly scope: ScopeService,
    private readonly storage: Storage,
    config: ConfigService<Env, true>,
  ) {
    this.invitesPerDay = config.get('INVITES_PER_DAY', { infer: true });
  }

  private readonly invitesPerDay: number;

  /** En instalaciones abiertas hay que confirmar el correo antes de crear empresas o invitar. */
  private async assertVerified(userId: string): Promise<void> {
    if (!this.deployment.emailVerificationRequired) return;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } });
    if (!user.emailVerifiedAt) throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED' });
  }

  /**
   * Quien crea la organización pasa a ser su administrador. Solo en instalaciones
   * abiertas: en la demo ya existe la empresa y en un cliente la crea el script de instalación.
   */
  async create(userId: string, dto: CreateOrganizationInput): Promise<WorkspaceSummary> {
    if (!this.deployment.organizationCreation) throw new ForbiddenException({ code: 'ORG_CREATION_DISABLED' });
    await this.assertVerified(userId);
    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        taxId: dto.taxId ?? null,
        settings: { ...DEFAULT_ORGANIZATION_SETTINGS },
        memberships: { create: { userId, role: 'ADMIN' } },
      },
    });
    return { kind: 'organization', organizationId: org.id, name: org.name, role: 'ADMIN' };
  }

  async settings(organizationId: string): Promise<OrganizationDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const s = resolveSettings(org.settings);
    return {
      id: org.id,
      name: org.name,
      taxId: org.taxId,
      currency: s.currency,
      timezone: s.timezone,
      nightStart: s.nightStart,
      nightEnd: s.nightEnd,
      mileageRatePerKm: s.mileageRatePerKm,
      allowEmployeeManualEntries: s.allowEmployeeManualEntries,
      defaultGeofenceRadiusMeters: s.defaultGeofenceRadiusMeters,
      photoRetentionMonths: s.photoRetentionMonths,
      quietHours: s.quietHours,
      geoNoticeText: s.geoNoticeText,
      region: s.region,
      vacationDays: s.vacationDays,
      vacationUnit: s.vacationUnit,
      requirePhotoOnClock: s.requirePhotoOnClock,
      lateToleranceMinutes: s.lateToleranceMinutes,
      alertsEnabled: s.alertsEnabled,
      missedClockInMinutes: s.missedClockInMinutes,
      maxOpenHours: s.maxOpenHours,
      overtimeYearLimit: s.overtimeYearLimit,
      monthlyTimesheet: s.monthlyTimesheet,
      payrollColumns: s.payrollColumns,
      overtimeSurchargePct: s.overtimeSurchargePct,
      brandName: s.brandName,
      accentColor: s.accentColor,
      hasLogo: !!s.logoKey,
    };
  }

  // ── Marca: logotipo ────────────────────────────────────────────────────

  /** Sube el logotipo (PNG o JPEG, como mucho 1 MB). Sustituye y borra el anterior. */
  async setLogo(organizationId: string, buffer: Buffer): Promise<OrganizationDto> {
    const kind = logoKind(buffer);
    if (!kind || buffer.length > 1024 * 1024) throw new BadRequestException({ code: 'LOGO_INVALID' });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const current = resolveSettings(org.settings);
    const key = `branding/${organizationId}/logo-${randomBytes(6).toString('hex')}.${kind.ext}`;
    await this.storage.put(key, buffer, kind.mime);
    await this.prisma.organization.update({ where: { id: organizationId }, data: { settings: { ...current, logoKey: key } } });
    if (current.logoKey) await this.storage.delete([current.logoKey]).catch(() => undefined);
    return this.settings(organizationId);
  }

  async removeLogo(organizationId: string): Promise<OrganizationDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const current = resolveSettings(org.settings);
    if (current.logoKey) {
      await this.prisma.organization.update({ where: { id: organizationId }, data: { settings: { ...current, logoKey: '' } } });
      await this.storage.delete([current.logoKey]).catch(() => undefined);
    }
    return this.settings(organizationId);
  }

  /** El logotipo, para la cabecera de la app y los PDF; null si no hay. */
  async logo(organizationId: string): Promise<{ body: Buffer; mime: string } | null> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } });
    const key = org ? resolveSettings(org.settings).logoKey : '';
    if (!key) return null;
    const body = await this.storage.get(key).catch(() => null);
    return body ? { body, mime: key.endsWith('.png') ? 'image/png' : 'image/jpeg' } : null;
  }

  async updateSettings(organizationId: string, dto: OrganizationSettingsInput): Promise<OrganizationDto> {
    // Una zona horaria inventada rompería los cálculos de horas: se comprueba que existe.
    try {
      new Intl.DateTimeFormat('es-ES', { timeZone: dto.timezone });
    } catch {
      throw new BadRequestException({ code: 'VALIDATION' });
    }
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const { name, taxId, ...changes } = dto;
    // Lo que no llega se conserva: un cliente antiguo no borra ajustes que no conoce.
    const provided = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { name, taxId: taxId ?? null, settings: { ...resolveSettings(org.settings), ...provided } },
    });
    return this.settings(organizationId);
  }

  async members(actorId: string, ws: WorkspaceContext): Promise<MemberDto[]> {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: ws.organizationId!, ...(await this.scope.userWhere(actorId, ws)) },
      include: { user: { select: { fullName: true, email: true } }, department: { select: { id: true, name: true } } },
      orderBy: [{ active: 'desc' }, { user: { fullName: 'asc' } }],
    });
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      fullName: m.user.fullName,
      email: m.user.email,
      role: m.role,
      jobTitle: m.jobTitle,
      active: m.active,
      joinedAt: m.createdAt.toISOString(),
      vacationDays: m.vacationDays,
      annualHours: m.annualHours === null ? null : Number(m.annualHours),
      weeklyHours: m.weeklyHours === null ? null : Number(m.weeklyHours),
      department: m.department,
      // El coste por hora es un dato salarial: solo lo ve la administración.
      hourlyCost: ws.kind === 'organization' && ws.role === 'ADMIN' && m.hourlyCost !== null ? Number(m.hourlyCost) : null,
    }));
  }

  private async assertDepartment(organizationId: string, departmentId: string | null | undefined): Promise<void> {
    if (!departmentId) return;
    const d = await this.prisma.department.findFirst({ where: { id: departmentId, organizationId }, select: { id: true } });
    if (!d) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  async updateMember(organizationId: string, membershipId: string, dto: UpdateMemberInput): Promise<void> {
    await this.assertDepartment(organizationId, dto.departmentId);
    const changed = await this.prisma.$transaction(async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id: membershipId, organizationId },
        include: { user: { select: { email: true, fullName: true, locale: true } }, organization: { select: { name: true } } },
      });
      if (!member) throw new NotFoundException({ code: 'NOT_FOUND' });
      // En la demo, las cuentas de prueba conservan su rol y su acceso: el siguiente visitante las necesita.
      if (this.deployment.isDemo && isDemoAccount(member.user.email) && (dto.role !== undefined || dto.active !== undefined)) {
        throw new ForbiddenException({ code: 'DEMO_READ_ONLY' });
      }
      const losesAdmin =
        member.role === 'ADMIN' &&
        member.active &&
        ((dto.role !== undefined && dto.role !== 'ADMIN') || dto.active === false);
      if (losesAdmin) {
        const admins = await tx.membership.count({ where: { organizationId, role: 'ADMIN', active: true } });
        if (admins <= 1) throw new ConflictException({ code: 'LAST_ADMIN' });
      }
      await tx.membership.update({ where: { id: member.id }, data: dto });
      // Quien deja de ser responsable deja de dirigir departamentos.
      if (dto.role !== undefined && dto.role !== 'MANAGER') await tx.departmentManager.deleteMany({ where: { membershipId: member.id } });
      return dto.role !== undefined && dto.role !== member.role && member.active && dto.active !== false ? { member, role: dto.role } : null;
    });
    // Con otro perfil cambian las pantallas: le llega el manual que le corresponde ahora.
    if (changed) void sendManual(this.mail, changed.member.user, changed.member.organization.name, changed.role);
  }

  /** Reenvía a una persona el manual de su perfil. */
  async sendMemberManual(organizationId: string, membershipId: string): Promise<{ emailed: boolean }> {
    const member = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId, active: true },
      include: { user: { select: { email: true, fullName: true, locale: true } }, organization: { select: { name: true } } },
    });
    if (!member) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { emailed: await sendManual(this.mail, member.user, member.organization.name, member.role) };
  }

  /** Invitaciones vivas y las recientes ya aceptadas o caducadas, con su estado. */
  async invitations(organizationId: string): Promise<InvitationDto[]> {
    const since = new Date(Date.now() - INVITATION_HISTORY_DAYS * 86_400_000);
    const rows = await this.prisma.invitation.findMany({
      where: { organizationId, OR: [{ acceptedAt: null }, { acceptedAt: { gt: since } }], createdAt: { gt: since } },
      include: { department: { select: { name: true } } },
      orderBy: { lastSentAt: 'desc' },
      take: 500,
    });
    const now = new Date();
    return rows.map((i) => invitationDto(i, now));
  }

  /** Cuántos correos de invitación quedan hoy a la empresa (límite de INVITES_PER_DAY en 24 h). */
  private async assertInviteQuota(organizationId: string, wanted: number): Promise<void> {
    const sent = await this.prisma.invitation.count({ where: { organizationId, lastSentAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (sent + wanted > this.invitesPerDay) throw new HttpException({ code: 'INVITE_LIMIT', remaining: Math.max(0, this.invitesPerDay - sent) }, HttpStatus.TOO_MANY_REQUESTS);
  }

  private async sendInvitation(inv: InvitationRow & { organization: { name: string }; invitedBy: { fullName: string; locale: string } }, token: string): Promise<boolean> {
    // El invitado aún no tiene idioma elegido: se usa el de quien invita.
    const locale = inv.invitedBy.locale === 'en' ? 'en' : 'es';
    const roles = locale === 'en' ? ROLE_EN : ROLE_ES;
    return this.mail.send(
      inv.email,
      invitationEmail(locale, {
        organization: inv.organization.name,
        inviter: inv.invitedBy.fullName,
        role: roles[inv.role],
        url: this.mail.link(`/invite/${token}`),
        days: INVITATION_DAYS,
      }),
      'invitation',
    );
  }

  /** Solo se guarda el hash del token: el enlace se muestra una única vez. */
  async invite(organizationId: string, invitedById: string, dto: CreateInvitationInput, checkQuota = true): Promise<InvitationDto> {
    await this.assertVerified(invitedById);
    await this.assertDepartment(organizationId, dto.departmentId);
    const already = await this.prisma.membership.findFirst({
      where: { organizationId, user: { email: dto.email } },
      select: { id: true },
    });
    if (already) throw new ConflictException({ code: 'ALREADY_MEMBER' });
    if (checkQuota) await this.assertInviteQuota(organizationId, 1);

    const token = randomBytes(24).toString('base64url');
    const inv = await this.prisma.$transaction(async (tx) => {
      // Una invitación viva por correo: la nueva sustituye a la anterior.
      await tx.invitation.deleteMany({ where: { organizationId, email: dto.email, acceptedAt: null } });
      return tx.invitation.create({
        data: {
          organizationId,
          invitedById,
          email: dto.email,
          role: dto.role,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
          fullName: dto.fullName ?? null,
          dniNie: dto.dniNie ?? null,
          jobTitle: dto.jobTitle ?? null,
          departmentId: dto.departmentId ?? null,
          weeklyHours: dto.weeklyHours ?? null,
        },
        include: { organization: { select: { name: true } }, invitedBy: { select: { fullName: true, locale: true } }, department: { select: { name: true } } },
      });
    });
    const emailed = await this.sendInvitation(inv, token);
    return { ...invitationDto(inv), emailed, token };
  }

  /** Vuelve a enviar la invitación con un enlace nuevo (el anterior deja de valer) y otros 7 días. */
  async resendInvitation(organizationId: string, id: string): Promise<InvitationDto> {
    const current = await this.prisma.invitation.findFirst({ where: { id, organizationId, acceptedAt: null } });
    if (!current) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (Date.now() - current.lastSentAt.getTime() < RESEND_COOLDOWN_MS) throw new HttpException({ code: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    await this.assertInviteQuota(organizationId, 1);
    const token = randomBytes(24).toString('base64url');
    const inv = await this.prisma.invitation.update({
      where: { id },
      data: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000), sendCount: { increment: 1 }, lastSentAt: new Date() },
      include: { organization: { select: { name: true } }, invitedBy: { select: { fullName: true, locale: true } }, department: { select: { name: true } } },
    });
    const emailed = await this.sendInvitation(inv, token);
    return { ...invitationDto(inv), emailed, token };
  }

  // ── Alta masiva ────────────────────────────────────────────────────────

  async previewImport(organizationId: string, file: Buffer): Promise<ImportPreview> {
    const members = await this.prisma.membership.findMany({ where: { organizationId }, select: { user: { select: { email: true } } } });
    try {
      return await readImport(file, new Set(members.map((m) => m.user.email.toLowerCase())));
    } catch (e) {
      if (e instanceof UnreadableImportError) throw new BadRequestException({ code: 'IMPORT_UNREADABLE' });
      throw e;
    }
  }

  /**
   * Crea las invitaciones de la plantilla ya revisada. Los departamentos que no
   * existen se crean; quien ya está en la empresa se salta.
   */
  async importInvitations(organizationId: string, invitedById: string, dto: ImportInvitationsInput): Promise<ImportResult> {
    await this.assertVerified(invitedById);
    const emails = [...new Set(dto.rows.map((r) => r.email))];
    const members = new Set(
      (await this.prisma.membership.findMany({ where: { organizationId, user: { email: { in: emails } } }, select: { user: { select: { email: true } } } })).map((m) =>
        m.user.email.toLowerCase(),
      ),
    );
    const rows = dto.rows.filter((r, i) => !members.has(r.email) && dto.rows.findIndex((x) => x.email === r.email) === i);
    await this.assertInviteQuota(organizationId, rows.length);

    const existing = await this.prisma.department.findMany({ where: { organizationId }, select: { id: true, name: true } });
    const byName = new Map(existing.map((d) => [d.name.toLocaleLowerCase('es'), d.id]));
    let departmentsCreated = 0;
    for (const name of new Set(rows.map((r) => r.department).filter((d): d is string => !!d))) {
      if (byName.has(name.toLocaleLowerCase('es'))) continue;
      const d = await this.prisma.department.create({ data: { organizationId, name } });
      byName.set(name.toLocaleLowerCase('es'), d.id);
      departmentsCreated++;
    }

    let invited = 0;
    let notEmailed = 0;
    for (const r of rows) {
      const inv = await this.invite(
        organizationId,
        invitedById,
        {
          email: r.email,
          role: r.role,
          fullName: r.fullName,
          dniNie: r.dniNie ?? undefined,
          jobTitle: r.jobTitle ?? undefined,
          departmentId: r.department ? (byName.get(r.department.toLocaleLowerCase('es')) ?? null) : null,
          weeklyHours: r.weeklyHours,
        },
        false,
      );
      invited++;
      if (!inv.emailed) notEmailed++;
    }
    return { invited, notEmailed, departmentsCreated };
  }

  async revokeInvitation(organizationId: string, id: string): Promise<void> {
    const { count } = await this.prisma.invitation.deleteMany({ where: { id, organizationId, acceptedAt: null } });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  async previewInvitation(token: string): Promise<InvitationPreview> {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: { select: { name: true } }, invitedBy: { select: { fullName: true } } },
    });
    if (!inv) throw new NotFoundException({ code: 'INVITATION_INVALID' });
    return {
      organizationName: inv.organization.name,
      email: inv.email,
      fullName: inv.fullName,
      role: inv.role,
      invitedBy: inv.invitedBy.fullName,
      status: inv.acceptedAt ? 'accepted' : inv.expiresAt < new Date() ? 'expired' : 'valid',
    };
  }

  /** La invitación solo vale para la cuenta con el correo al que se envió. */
  async acceptInvitation(token: string, userId: string): Promise<WorkspaceSummary> {
    const { ws, user } = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invitation.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { organization: { select: { name: true } } },
      });
      if (!inv) throw new NotFoundException({ code: 'INVITATION_INVALID' });
      if (inv.acceptedAt || inv.expiresAt < new Date()) throw new GoneException({ code: 'INVITATION_INVALID' });
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, fullName: true, locale: true } });
      if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
        throw new ForbiddenException({ code: 'INVITATION_EMAIL_MISMATCH' });
      }
      // El enlace llegó a ese buzón: queda demostrado que el correo es suyo.
      if (!user.emailVerifiedAt) await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      // Los datos que dejó preparados la empresa (alta masiva) pasan a la ficha.
      await tx.membership.upsert({
        where: { userId_organizationId: { userId, organizationId: inv.organizationId } },
        create: {
          userId,
          organizationId: inv.organizationId,
          role: inv.role,
          jobTitle: inv.jobTitle,
          departmentId: inv.departmentId,
          weeklyHours: inv.weeklyHours,
        },
        update: {},
      });
      if (inv.dniNie) await tx.user.updateMany({ where: { id: userId, dniNie: null }, data: { dniNie: inv.dniNie } });
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      return { ws: { kind: 'organization' as const, organizationId: inv.organizationId, name: inv.organization.name, role: inv.role }, user };
    });
    // Bienvenida: el manual de su perfil, para empezar con buen pie.
    void sendManual(this.mail, user, ws.name, ws.role);
    return ws;
  }
}
