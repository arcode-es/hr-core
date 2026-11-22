import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@hr/shared';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
}

/** Espacio activo de la petición, resuelto a partir de la cabecera X-Workspace. */
export type WorkspaceContext =
  | { kind: 'personal'; organizationId: null }
  | { kind: 'organization'; organizationId: string; role: Role; membershipId: string };

export interface AppRequest extends Request {
  user?: AuthUser;
  workspace?: WorkspaceContext;
}

export const IS_PUBLIC = 'isPublic';
/** Ruta accesible sin sesión. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Exige un espacio de organización y uno de estos roles en ella. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const ALLOW_READ_ONLY = 'allowReadOnly';
/**
 * Ruta que cambia datos fuera de una empresa y debe funcionar aunque no haya espacio personal:
 * lo propio de la cuenta (perfil, avisos, sesiones, aceptar una invitación).
 */
export const AllowReadOnly = () => SetMetadata(ALLOW_READ_ONLY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().user!,
);

export const CurrentWorkspace = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>().workspace!,
);

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return { ip: req.ip ?? null, userAgent: req.get('user-agent')?.slice(0, 400) ?? null };
});
