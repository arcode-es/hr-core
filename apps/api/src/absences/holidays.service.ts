import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type HolidayDto, type HolidayInput, resolveSettings } from '@hr/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HolidaysProvider } from './holidays.provider';

const day = (d: string): Date => new Date(`${d}T00:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);

const include = { location: { select: { id: true, name: true } } } satisfies Prisma.HolidayInclude;
type Row = Prisma.HolidayGetPayload<{ include: typeof include }>;
const toDto = (h: Row): HolidayDto => ({ id: h.id, date: iso(h.date), name: h.name, scope: h.scope, location: h.location });

/** Festivos de un periodo: los de toda la empresa y los de cada ubicación. */
export interface HolidayCalendar {
  companyWide: Set<string>;
  byLocation: Map<string, Set<string>>;
  /** ¿Es festivo ese día para quien trabaja en esa ubicación (o sin ubicación)? */
  isHoliday(date: string, locationId: string | null): boolean;
}

@Injectable()
export class HolidaysService {
  private readonly log = new Logger('Festivos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: HolidaysProvider,
  ) {}

  async list(organizationId: string, from: string, to: string): Promise<HolidayDto[]> {
    const rows = await this.prisma.holiday.findMany({
      where: { organizationId, date: { gte: day(from), lte: day(to) } },
      include,
      orderBy: [{ date: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  async calendar(organizationId: string, from: string, to: string): Promise<HolidayCalendar> {
    const rows = await this.prisma.holiday.findMany({ where: { organizationId, date: { gte: day(from), lte: day(to) } }, select: { date: true, locationId: true } });
    const companyWide = new Set<string>();
    const byLocation = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.locationId) companyWide.add(iso(r.date));
      else {
        if (!byLocation.has(r.locationId)) byLocation.set(r.locationId, new Set());
        byLocation.get(r.locationId)!.add(iso(r.date));
      }
    }
    return {
      companyWide,
      byLocation,
      isHoliday: (date, locationId) => companyWide.has(date) || (!!locationId && !!byLocation.get(locationId)?.has(date)),
    };
  }

  async create(organizationId: string, dto: HolidayInput): Promise<HolidayDto> {
    if (dto.locationId) {
      const loc = await this.prisma.location.findFirst({ where: { id: dto.locationId, organizationId }, select: { id: true } });
      if (!loc) throw new BadRequestException({ code: 'VALIDATION' });
    }
    const row = await this.prisma.holiday.create({
      data: { organizationId, date: day(dto.date), name: dto.name, scope: dto.scope, locationId: dto.scope === 'LOCAL' ? (dto.locationId ?? null) : null },
      include,
    });
    return toDto(row);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const { count } = await this.prisma.holiday.deleteMany({ where: { id, organizationId } });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  /** Trae los festivos nacionales y autonómicos del año. No duplica los que ya estén. */
  async import(organizationId: string, year: number): Promise<{ imported: number; skipped: number }> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const region = resolveSettings(org.settings).region;
    let official;
    try {
      official = await this.provider.fetch(year, region);
    } catch (e) {
      this.log.warn(`No se pudieron traer los festivos de ${year}: ${e instanceof Error ? e.message : String(e)}`);
      throw new BadGatewayException({ code: 'HOLIDAYS_UNAVAILABLE' });
    }
    const existing = await this.prisma.holiday.findMany({
      where: { organizationId, locationId: null, date: { gte: day(`${year}-01-01`), lte: day(`${year}-12-31`) } },
      select: { date: true },
    });
    const taken = new Set(existing.map((h) => iso(h.date)));
    const fresh = official.filter((h) => !taken.has(h.date));
    // Un mismo día puede venir dos veces (nacional y autonómico): se guarda una.
    const unique = [...new Map(fresh.map((h) => [h.date, h])).values()];
    if (unique.length) {
      await this.prisma.holiday.createMany({ data: unique.map((h) => ({ organizationId, date: day(h.date), name: h.name, scope: h.scope })) });
    }
    return { imported: unique.length, skipped: official.length - unique.length };
  }
}
