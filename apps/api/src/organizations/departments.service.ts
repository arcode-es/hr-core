import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { DepartmentDto } from '@hr/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const include = {
  _count: { select: { members: { where: { active: true } } } },
  managers: { include: { membership: { select: { id: true, user: { select: { fullName: true } } } } } },
} satisfies Prisma.DepartmentInclude;
type Row = Prisma.DepartmentGetPayload<{ include: typeof include }>;

const toDto = (d: Row): DepartmentDto => ({
  id: d.id,
  name: d.name,
  members: d._count.members,
  managers: d.managers.map((m) => ({ membershipId: m.membership.id, fullName: m.membership.user.fullName })).sort((a, b) => a.fullName.localeCompare(b.fullName, 'es')),
});

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<DepartmentDto[]> {
    const rows = await this.prisma.department.findMany({ where: { organizationId }, include, orderBy: { name: 'asc' } });
    return rows.map(toDto);
  }

  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'DEPARTMENT_EXISTS' });
      throw e;
    }
  }

  async create(organizationId: string, name: string): Promise<DepartmentDto> {
    return toDto(await this.unique(() => this.prisma.department.create({ data: { organizationId, name }, include })));
  }

  async rename(organizationId: string, id: string, name: string): Promise<DepartmentDto> {
    const { count } = await this.unique(() => this.prisma.department.updateMany({ where: { id, organizationId }, data: { name } }));
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
    return toDto(await this.prisma.department.findUniqueOrThrow({ where: { id }, include }));
  }

  /** Las personas del departamento se quedan sin departamento; sus responsables vuelven a ver a toda la empresa. */
  async remove(organizationId: string, id: string): Promise<void> {
    const { count } = await this.prisma.department.deleteMany({ where: { id, organizationId } });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  async setManagers(organizationId: string, id: string, membershipIds: string[]): Promise<DepartmentDto> {
    const dept = await this.prisma.department.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!dept) throw new NotFoundException({ code: 'NOT_FOUND' });
    const ids = [...new Set(membershipIds)];
    const managers = await this.prisma.membership.count({ where: { id: { in: ids }, organizationId, role: 'MANAGER', active: true } });
    if (managers !== ids.length) throw new BadRequestException({ code: 'VALIDATION' });
    await this.prisma.$transaction([
      this.prisma.departmentManager.deleteMany({ where: { departmentId: id } }),
      this.prisma.departmentManager.createMany({ data: ids.map((membershipId) => ({ departmentId: id, membershipId })) }),
    ]);
    return toDto(await this.prisma.department.findUniqueOrThrow({ where: { id }, include }));
  }
}
