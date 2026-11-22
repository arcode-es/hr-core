import { brandingOf } from '../organizations/branding';
import { Body, Controller, Get, NotFoundException, Patch } from '@nestjs/common';
import { MeResponse, UpdateProfileInput, updateProfileSchema, UserProfile, WorkspaceSummary } from '@hr/shared';
import type { User } from '@prisma/client';
import { AuthUser, CurrentUser, AllowReadOnly } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { Deployment } from '../deployment/deployment';
import { PrismaService } from '../prisma/prisma.service';

const toProfile = (u: User): UserProfile => ({
  id: u.id,
  email: u.email,
  fullName: u.fullName,
  dniNie: u.dniNie,
  phone: u.phone,
  locale: u.locale === 'en' ? 'en' : 'es',
  timezone: u.timezone,
  isSuperadmin: u.isSuperadmin,
  emailVerified: u.emailVerifiedAt !== null,
});

@AllowReadOnly()
@Controller('me')
export class AccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployment: Deployment,
  ) {}

  /**
   * Perfil y espacios disponibles: cada organización activa y, en instalaciones
   * abiertas, el espacio personal. En la demo y en un cliente solo hay empresa.
   */
  @Get()
  async me(@CurrentUser() auth: AuthUser): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.id },
      include: {
        memberships: {
          where: { active: true },
          include: { organization: { select: { name: true, settings: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND' });
    const workspaces: WorkspaceSummary[] = [
      ...(this.deployment.personalWorkspace ? [{ kind: 'personal' as const }] : []),
      ...user.memberships.map((m) => ({
        kind: 'organization' as const,
        organizationId: m.organizationId,
        name: m.organization.name,
        role: m.role,
        geoNoticeAccepted: m.geoNoticeAcceptedAt !== null,
        branding: brandingOf(m.organization.settings),
      })),
    ];
    return { user: toProfile(user), workspaces };
  }

  @Patch()
  async update(
    @CurrentUser() auth: AuthUser,
    @Body(new ZodPipe(updateProfileSchema)) dto: UpdateProfileInput,
  ): Promise<UserProfile> {
    return toProfile(await this.prisma.user.update({ where: { id: auth.id }, data: dto }));
  }
}
