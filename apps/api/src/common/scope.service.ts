import { Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceContext } from './context';

/**
 * A quién ve quien supervisa. Un responsable con departamentos asignados solo ve a
 * la gente de esos departamentos (y a sí mismo); sin departamentos, a toda la
 * empresa, como la administración y la inspección.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** null = todas las personas de la empresa. */
  async visibleUserIds(actorId: string, ws: WorkspaceContext): Promise<string[] | null> {
    if (ws.kind !== 'organization' || ws.role !== 'MANAGER') return null;
    const depts = await this.prisma.departmentManager.findMany({ where: { membershipId: ws.membershipId }, select: { departmentId: true } });
    if (!depts.length) return null;
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: ws.organizationId, departmentId: { in: depts.map((d) => d.departmentId) } },
      select: { userId: true },
    });
    return [...new Set([actorId, ...rows.map((r) => r.userId)])];
  }

  /** Filtro de Prisma por persona: vacío si ve a todo el mundo. */
  async userWhere(actorId: string, ws: WorkspaceContext): Promise<{ userId?: { in: string[] } }> {
    const ids = await this.visibleUserIds(actorId, ws);
    return ids ? { userId: { in: ids } } : {};
  }

  /** Para actuar sobre algo de otra persona: si no es de su gente, como si no existiera. */
  async assertVisible(actorId: string, ws: WorkspaceContext, userId: string): Promise<void> {
    const ids = await this.visibleUserIds(actorId, ws);
    if (ids && !ids.includes(userId)) throw new NotFoundException({ code: 'NOT_FOUND' });
  }
}

@Global()
@Module({ providers: [ScopeService], exports: [ScopeService] })
export class ScopeModule {}
