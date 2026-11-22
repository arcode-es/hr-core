import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  type DepartmentDto,
  type DepartmentInput,
  departmentManagersSchema,
  departmentSchema,
  type ImportInvitationsInput,
  importInvitationsSchema,
  type ImportPreview,
  type ImportResult,
  CreateInvitationInput,
  createInvitationSchema,
  CreateOrganizationInput,
  createOrganizationSchema,
  InvitationDto,
  InvitationPreview,
  MemberDto,
  OrganizationDto,
  OrganizationSettingsInput,
  organizationSettingsSchema,
  UpdateMemberInput,
  updateMemberSchema,
  WorkspaceSummary,
} from '@hr/shared';
import { AuthUser, CurrentUser, CurrentWorkspace, Public, Roles, WorkspaceContext, AllowReadOnly } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { DepartmentsService } from './departments.service';
import { importTemplate } from './import';
import { OrganizationsService } from './organizations.service';

type OrgWorkspace = Extract<WorkspaceContext, { kind: 'organization' }>;

@Controller()
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly departments: DepartmentsService,
  ) {}

  // Sin espacio de empresa todavía: el propio servicio decide si esta instalación deja crear empresas.
  @AllowReadOnly()
  @Post('organizations')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createOrganizationSchema)) dto: CreateOrganizationInput,
  ): Promise<WorkspaceSummary> {
    return this.orgs.create(user.id, dto);
  }

  @Get('organization')
  @Roles('ADMIN', 'MANAGER', 'INSPECTOR')
  settings(@CurrentWorkspace() ws: OrgWorkspace): Promise<OrganizationDto> {
    return this.orgs.settings(ws.organizationId);
  }

  @Patch('organization')
  @Roles('ADMIN')
  updateSettings(
    @CurrentWorkspace() ws: OrgWorkspace,
    @Body(new ZodPipe(organizationSettingsSchema)) dto: OrganizationSettingsInput,
  ): Promise<OrganizationDto> {
    return this.orgs.updateSettings(ws.organizationId, dto);
  }

  // ── Marca ──────────────────────────────────────────────────────────────

  @Post('organization/logo')
  @Roles('ADMIN')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024, files: 1 } }))
  setLogo(@CurrentWorkspace() ws: OrgWorkspace, @UploadedFile() file?: Express.Multer.File): Promise<OrganizationDto> {
    if (!file) throw new BadRequestException({ code: 'LOGO_INVALID' });
    return this.orgs.setLogo(ws.organizationId, file.buffer);
  }

  @Delete('organization/logo')
  @Roles('ADMIN')
  removeLogo(@CurrentWorkspace() ws: OrgWorkspace): Promise<OrganizationDto> {
    return this.orgs.removeLogo(ws.organizationId);
  }

  /** Cualquiera de la empresa: se muestra en la cabecera de la app. */
  @Get('organization/logo')
  async logo(@CurrentWorkspace() ws: WorkspaceContext, @Res() res: Response): Promise<void> {
    const logo = ws.kind === 'organization' ? await this.orgs.logo(ws.organizationId) : null;
    if (!logo) {
      res.status(404).json({ code: 'NOT_FOUND' });
      return;
    }
    res.set({ 'Content-Type': logo.mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    res.send(logo.body);
  }

  // ── Equipo del espacio activo ──────────────────────────────────────────

  @Get('members')
  @Roles('ADMIN', 'MANAGER', 'INSPECTOR')
  members(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: OrgWorkspace): Promise<MemberDto[]> {
    return this.orgs.members(user.id, ws);
  }

  @Patch('members/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  updateMember(
    @CurrentWorkspace() ws: OrgWorkspace,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateMemberSchema)) dto: UpdateMemberInput,
  ): Promise<void> {
    return this.orgs.updateMember(ws.organizationId, id, dto);
  }

  @Post('members/:id/manual')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  sendManual(@CurrentWorkspace() ws: OrgWorkspace, @Param('id', ParseUUIDPipe) id: string): Promise<{ emailed: boolean }> {
    return this.orgs.sendMemberManual(ws.organizationId, id);
  }

  @Get('invitations')
  @Roles('ADMIN', 'MANAGER')
  invitations(@CurrentWorkspace() ws: OrgWorkspace): Promise<InvitationDto[]> {
    return this.orgs.invitations(ws.organizationId);
  }

  @Post('invitations')
  @Roles('ADMIN')
  invite(
    @CurrentWorkspace() ws: OrgWorkspace,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createInvitationSchema)) dto: CreateInvitationInput,
  ): Promise<InvitationDto> {
    return this.orgs.invite(ws.organizationId, user.id, dto);
  }

  @Post('invitations/:id/resend')
  @Roles('ADMIN')
  @HttpCode(200)
  resend(@CurrentWorkspace() ws: OrgWorkspace, @Param('id', ParseUUIDPipe) id: string): Promise<InvitationDto> {
    return this.orgs.resendInvitation(ws.organizationId, id);
  }

  // ── Alta masiva ────────────────────────────────────────────────────────

  @Get('invitations/import/template.xlsx')
  @Roles('ADMIN')
  async template(@Res() res: Response): Promise<void> {
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-alta-masiva.xlsx"',
      'Cache-Control': 'no-store',
    });
    res.send(await importTemplate());
  }

  /** Lee la plantilla (CSV o XLSX) y devuelve las filas con sus errores, sin crear nada. */
  @Post('invitations/import/preview')
  @Roles('ADMIN')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  preview_(@CurrentWorkspace() ws: OrgWorkspace, @UploadedFile() file?: Express.Multer.File): Promise<ImportPreview> {
    if (!file) throw new BadRequestException({ code: 'IMPORT_UNREADABLE' });
    return this.orgs.previewImport(ws.organizationId, file.buffer);
  }

  @Post('invitations/import')
  @Roles('ADMIN')
  importRows(
    @CurrentWorkspace() ws: OrgWorkspace,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(importInvitationsSchema)) dto: ImportInvitationsInput,
  ): Promise<ImportResult> {
    return this.orgs.importInvitations(ws.organizationId, user.id, dto);
  }

  // ── Departamentos ──────────────────────────────────────────────────────

  @Get('departments')
  @Roles('ADMIN', 'MANAGER', 'INSPECTOR')
  listDepartments(@CurrentWorkspace() ws: OrgWorkspace): Promise<DepartmentDto[]> {
    return this.departments.list(ws.organizationId);
  }

  @Post('departments')
  @Roles('ADMIN')
  createDepartment(@CurrentWorkspace() ws: OrgWorkspace, @Body(new ZodPipe(departmentSchema)) dto: DepartmentInput): Promise<DepartmentDto> {
    return this.departments.create(ws.organizationId, dto.name);
  }

  @Patch('departments/:id')
  @Roles('ADMIN')
  renameDepartment(@CurrentWorkspace() ws: OrgWorkspace, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(departmentSchema)) dto: DepartmentInput): Promise<DepartmentDto> {
    return this.departments.rename(ws.organizationId, id, dto.name);
  }

  @Delete('departments/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  removeDepartment(@CurrentWorkspace() ws: OrgWorkspace, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.departments.remove(ws.organizationId, id);
  }

  /** Responsables del departamento: con alguno asignado, solo ven a su gente. */
  @Put('departments/:id/managers')
  @Roles('ADMIN')
  setManagers(
    @CurrentWorkspace() ws: OrgWorkspace,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(departmentManagersSchema)) dto: { membershipIds: string[] },
  ): Promise<DepartmentDto> {
    return this.departments.setManagers(ws.organizationId, id, dto.membershipIds);
  }

  @Delete('invitations/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  revoke(@CurrentWorkspace() ws: OrgWorkspace, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.orgs.revokeInvitation(ws.organizationId, id);
  }

  // ── Aceptación por enlace ──────────────────────────────────────────────

  @Public()
  @Get('invite/:token')
  preview(@Param('token') token: string): Promise<InvitationPreview> {
    return this.orgs.previewInvitation(token);
  }

  @AllowReadOnly()
  @Post('invite/:token/accept')
  @HttpCode(200)
  accept(@Param('token') token: string, @CurrentUser() user: AuthUser): Promise<WorkspaceSummary> {
    return this.orgs.acceptInvitation(token, user.id);
  }
}
