import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@hr/shared';
import { ALLOW_READ_ONLY, AppRequest, ROLES } from '../common/context';
import { Deployment } from '../deployment/deployment';
import { PrismaService } from '../prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard global (tras AuthGuard): resuelve el espacio activo desde `X-Workspace`
 * (`personal` o el id de una organización), comprueba que el usuario pertenece
 * a ella y aplica @Roles. La pertenencia se consulta en cada petición, así que
 * desactivar a un miembro surte efecto de inmediato.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly deployment: Deployment,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.user) return true; // ruta pública

    const header = req.get('x-workspace') ?? 'personal';
    if (header === 'personal') {
      req.workspace = { kind: 'personal', organizationId: null };
    } else {
      if (!UUID.test(header)) throw new BadRequestException({ code: 'VALIDATION' });
      const membership = await this.prisma.membership.findUnique({
        where: { userId_organizationId: { userId: req.user.id, organizationId: header } },
      });
      if (!membership?.active) throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
      req.workspace = {
        kind: 'organization',
        organizationId: header,
        role: membership.role,
        membershipId: membership.id,
      };
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length) {
      const ws = req.workspace;
      if (ws.kind !== 'organization' || !roles.includes(ws.role)) {
        throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
      }
    }
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const allowed = mutating ? this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_READ_ONLY, [ctx.getHandler(), ctx.getClass()]) : true;
    // El espacio personal solo existe en instalaciones abiertas. En la demo y en el servidor de una
    // empresa no se escribe nada fuera de ella (lo propio de la cuenta —perfil, sesiones, avisos,
    // aceptar una invitación— va marcado con @AllowReadOnly).
    if (req.workspace.kind === 'personal' && !this.deployment.personalWorkspace && !allowed) {
      throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
    }
    return true;
  }
}
