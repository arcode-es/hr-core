import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GeofenceMatch, LOCATION_COLORS, LocationDto, LocationInput, PositionQuery, UpdateLocationInput } from '@hr/shared';
import { Location, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { WorkspaceContext } from '../common/context';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateGeofence } from './geofence';

const toDto = (l: Pick<Location, 'id' | 'name' | 'address' | 'latitude' | 'longitude' | 'geofenceRadiusMeters' | 'color' | 'isActive' | 'organizationId'>): LocationDto => ({
  id: l.id,
  name: l.name,
  address: l.address,
  latitude: l.latitude,
  longitude: l.longitude,
  geofenceRadiusMeters: l.geofenceRadiusMeters,
  color: l.color ?? LOCATION_COLORS[0],
  isActive: l.isActive,
  personal: l.organizationId === null,
});

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Las ubicaciones nunca se mezclan: las de la empresa en su espacio, las personales en el personal. */
  private scope(userId: string, ws: WorkspaceContext): Prisma.LocationWhereInput {
    return ws.kind === 'organization' ? { organizationId: ws.organizationId } : { organizationId: null, userId };
  }

  private assertCanManage(ws: WorkspaceContext): void {
    if (ws.kind === 'organization' && ws.role !== 'ADMIN' && ws.role !== 'MANAGER') {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }
  }

  async list(userId: string, ws: WorkspaceContext): Promise<LocationDto[]> {
    const canSeeInactive = ws.kind === 'personal' || ws.role === 'ADMIN' || ws.role === 'MANAGER';
    const rows = await this.prisma.location.findMany({
      where: { ...this.scope(userId, ws), ...(canSeeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(userId: string, ws: WorkspaceContext, dto: LocationInput): Promise<LocationDto> {
    this.assertCanManage(ws);
    const row = await this.prisma.location.create({
      data: {
        ...dto,
        address: dto.address ?? null,
        ...(ws.kind === 'organization' ? { organizationId: ws.organizationId } : { userId }),
      },
    });
    return toDto(row);
  }

  async update(userId: string, ws: WorkspaceContext, id: string, dto: UpdateLocationInput): Promise<LocationDto> {
    this.assertCanManage(ws);
    const existing = await this.prisma.location.findFirst({ where: { id, ...this.scope(userId, ws) }, select: { id: true } });
    if (!existing) throw new NotFoundException({ code: 'NOT_FOUND' });
    return toDto(await this.prisma.location.update({ where: { id }, data: dto }));
  }

  /**
   * Ubicaciones activas del espacio ordenadas por cercanía a una posición, con
   * su evaluación de geocerca. La distancia la calcula PostGIS sobre el geoide.
   */
  async near(userId: string, ws: WorkspaceContext, pos: PositionQuery, limit = 5, onlyLocationId?: string): Promise<GeofenceMatch[]> {
    const scope =
      ws.kind === 'organization'
        ? Prisma.sql`organization_id = ${ws.organizationId}::uuid`
        : Prisma.sql`organization_id IS NULL AND user_id = ${userId}::uuid`;
    // Con turno asignado se compara con su ubicación, no con la más cercana.
    const owner = onlyLocationId ? Prisma.sql`${scope} AND id = ${onlyLocationId}::uuid` : scope;
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        address: string | null;
        latitude: number;
        longitude: number;
        geofenceRadiusMeters: number;
        color: string | null;
        isActive: boolean;
        organizationId: string | null;
        distance: number;
      }[]
    >`
      SELECT id, name, address, latitude, longitude, color,
             geofence_radius_meters AS "geofenceRadiusMeters",
             is_active AS "isActive",
             organization_id AS "organizationId",
             ST_Distance(geom, ST_SetSRID(ST_MakePoint(${pos.lng}, ${pos.lat}), 4326)::geography) AS distance
      FROM locations
      WHERE is_active AND ${owner}
      ORDER BY distance
      LIMIT ${limit}`;
    return rows.map((r) => ({
      location: toDto(r),
      distanceMeters: Math.round(r.distance),
      ...evaluateGeofence(r.distance, r.geofenceRadiusMeters, pos.accuracy),
    }));
  }

  /** Genera (o cambia) el código QR de una ubicación: el anterior deja de valer. */
  async regenerateQr(userId: string, ws: WorkspaceContext, id: string): Promise<{ code: string }> {
    this.assertCanManage(ws);
    const loc = await this.prisma.location.findFirst({ where: { id, ...this.scope(userId, ws) }, select: { id: true } });
    if (!loc) throw new NotFoundException({ code: 'NOT_FOUND' });
    const code = randomBytes(18).toString('base64url');
    await this.prisma.location.update({ where: { id }, data: { qrCode: code } });
    return { code };
  }

  /** Datos para el cartel del QR; si la ubicación aún no tiene código, se le crea. */
  async qrInfo(userId: string, ws: WorkspaceContext, id: string): Promise<{ name: string; address: string | null; code: string; organization: string | null }> {
    this.assertCanManage(ws);
    const loc = await this.prisma.location.findFirst({ where: { id, ...this.scope(userId, ws) }, include: { organization: { select: { name: true } } } });
    if (!loc) throw new NotFoundException({ code: 'NOT_FOUND' });
    const code = loc.qrCode ?? (await this.regenerateQr(userId, ws, id)).code;
    return { name: loc.name, address: loc.address, code, organization: loc.organization?.name ?? null };
  }
}
