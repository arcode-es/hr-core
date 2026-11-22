import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClockInput, ClockState, ClockStatus, GeofenceMatch, HandoverNoteDto, PersonRef, PositionQuery, SentHandoverNoteDto, WorkdayDto } from '@hr/shared';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../common/context';
import { imageExtension, imageMime } from '../common/images';
import { GeoService } from '../geo/geo.service';
import { LocationsService } from '../locations/locations.service';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftsService, toShiftDto } from '../shifts/shifts.service';
import { Storage } from '../storage/storage';
import { groupWorkdays, toWorkday, withLocation } from './mappers';

/** Fichaje desde un quiosco: la ubicación (y su dirección) es la del quiosco. */
export interface ClockVia {
  kiosk?: { locationId: string | null; address: string | null };
}

export interface PhotoUpload {
  buffer: Buffer;
  mimetype: string;
}

/** Un evento sin conexión se acepta hasta una semana después. */
const OFFLINE_MAX_AGE_MS = 7 * 86_400_000;
/** Margen por si el reloj del móvil va algo adelantado. */
const OFFLINE_CLOCK_SKEW_MS = 5 * 60_000;
/** Una nota para «el siguiente turno» espera este tiempo; pasado, ya no se entrega a nadie. */
const HANDOVER_OPEN_MS = 72 * 3_600_000;

@Injectable()
export class TimeService {
  private readonly log = new Logger(TimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly geo: GeoService,
    private readonly storage: Storage,
    private readonly shifts: ShiftsService,
    private readonly visibility: ScopeService,
  ) {}

  private scope(userId: string, ws: WorkspaceContext): Prisma.TimeEntryWhereInput {
    return { userId, organizationId: ws.organizationId, voidedAt: null };
  }

  async status(userId: string, ws: WorkspaceContext): Promise<ClockStatus> {
    const now = new Date();
    const open = await this.prisma.timeEntry.findFirst({
      where: { ...this.scope(userId, ws), endTime: null },
      select: { workdayId: true, entryType: true },
    });
    const shift = await this.shifts.current(userId, ws, now, 12);
    const shiftDto = shift ? toShiftDto(shift) : null;
    const requirePhoto = ws.kind === 'organization' && (await this.shifts.settings(userId, ws)).requirePhotoOnClock;
    const notes = await this.pendingNotes(userId, ws);
    if (!open) return { serverTime: now.toISOString(), state: 'IDLE', workday: null, shift: shiftDto, requirePhoto, notes };
    const entries = await this.prisma.timeEntry.findMany({
      where: { ...this.scope(userId, ws), workdayId: open.workdayId },
      include: withLocation,
      orderBy: { startTime: 'asc' },
    });
    const state: ClockState = open.entryType === 'WORK' ? 'WORKING' : 'PAUSED';
    return { serverTime: now.toISOString(), state, workday: toWorkday(entries, now), shift: shiftDto, requirePhoto, notes };
  }

  /**
   * Registra un evento de fichaje. La hora oficial es la del servidor; la del
   * dispositivo se guarda aparte. Fichar fuera de perímetro o sin posición
   * nunca se rechaza: queda señalado en el registro.
   */
  async clock(userId: string, ws: WorkspaceContext, dto: ClockInput, photo?: PhotoUpload, via: ClockVia = {}): Promise<ClockStatus> {
    if (ws.kind === 'organization' && ws.role === 'INSPECTOR') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });

    // Reintento de un evento ya procesado (red inestable, cola sin conexión): no se aplica dos veces.
    const duplicate = await this.prisma.clockEvent.findUnique({ where: { clientUuid: dto.clientUuid } });
    if (duplicate) {
      if (duplicate.userId !== userId) throw new ConflictException({ code: 'INVALID_CLOCK_STATE' });
      return this.status(userId, ws);
    }

    const ext = photo ? imageExtension(photo.buffer) : null;
    if (photo && !ext) throw new BadRequestException({ code: 'INVALID_PHOTO' });

    // Foto obligatoria al empezar y al terminar, si la empresa la pide. Sin cámara se admite, señalado.
    const settings = ws.kind === 'organization' ? await this.shifts.settings(userId, ws) : null;
    const photoMissing = !!settings?.requirePhotoOnClock && (dto.action === 'START' || dto.action === 'STOP') && !photo;
    if (photoMissing && !dto.photoUnavailable) throw new BadRequestException({ code: 'PHOTO_REQUIRED' });

    // QR de la ubicación: prueba de presencia sin GPS. Tiene que ser el código vigente.
    let qrLocation: { id: string; address: string | null } | null = null;
    if (dto.qr) {
      qrLocation = await this.prisma.location.findFirst({
        where: {
          id: dto.qr.locationId,
          qrCode: dto.qr.code,
          isActive: true,
          ...(ws.kind === 'organization' ? { organizationId: ws.organizationId } : { organizationId: null, userId }),
        },
        select: { id: true, address: true },
      });
      if (!qrLocation) throw new BadRequestException({ code: 'QR_INVALID' });
    }

    // Nota de relevo: solo en una empresa y para alguien que siga en ella.
    if (dto.note) {
      if (ws.kind !== 'organization') throw new BadRequestException({ code: 'VALIDATION' });
      if (dto.note.recipientId) {
        const colleagues = await this.colleagues(userId, ws);
        if (!colleagues.some((c) => c.id === dto.note!.recipientId)) throw new BadRequestException({ code: 'HANDOVER_RECIPIENT_INVALID' });
      }
    }

    const open = await this.prisma.timeEntry.findFirst({ where: { ...this.scope(userId, ws), endTime: null } });
    const valid =
      (dto.action === 'START' && !open) ||
      (dto.action === 'PAUSE' && open?.entryType === 'WORK') ||
      (dto.action === 'RESUME' && !!open && open.entryType !== 'WORK') ||
      (dto.action === 'STOP' && !!open);
    if (!valid) throw new ConflictException({ code: 'INVALID_CLOCK_STATE' });

    const received = new Date();
    // En línea manda la hora del servidor. Un evento registrado sin conexión trae la
    // suya, que se acepta dentro de unos límites y siempre posterior al tramo abierto.
    const offline = dto.occurredAt !== undefined;
    const now = offline ? new Date(dto.occurredAt!) : received;
    if (offline) {
      const tooOld = received.getTime() - now.getTime() > OFFLINE_MAX_AGE_MS;
      const inFuture = now.getTime() - received.getTime() > OFFLINE_CLOCK_SKEW_MS;
      if (tooOld || inFuture || (open && now < open.startTime)) throw new ConflictException({ code: 'OFFLINE_EVENT_REJECTED' });
      // Un evento con fecha pasada no puede solaparse con tiempo ya registrado: ni empezar dentro
      // de otro tramo, ni cerrar el tramo abierto por encima de otro que empezó después.
      const overlap = await this.prisma.timeEntry.findFirst({
        where: {
          ...this.scope(userId, ws),
          ...(open ? { id: { not: open.id }, startTime: { gt: open.startTime, lt: now } } : { startTime: { lte: now }, endTime: { gt: now } }),
        },
        select: { id: true },
      });
      if (overlap) throw new ConflictException({ code: 'OFFLINE_EVENT_REJECTED' });
    }
    const clientTime = new Date(dto.clientTime);
    const pos = dto.position;
    // La jornada queda ligada al turno con el que empezó.
    const currentShift = open ? null : await this.shifts.current(userId, ws, now);
    const shiftId = open ? open.shiftId : (currentShift?.id ?? null);
    const nearest = pos ? await this.geofence(userId, ws, pos, shiftId) : undefined;

    // Cómo se comprueba la presencia y dónde: el quiosco y el QR son su propia ubicación.
    const presenceMethod = via.kiosk ? ('KIOSK' as const) : qrLocation ? ('QR' as const) : pos ? ('GPS' as const) : ('NONE' as const);
    const fixedLocation = via.kiosk ? { id: via.kiosk.locationId, address: via.kiosk.address } : qrLocation;
    const locationId = fixedLocation ? fixedLocation.id : (nearest?.location.id ?? null);
    const within = fixedLocation ? true : nearest ? nearest.within : null;
    // Dentro de una ubicación conocida se usa su dirección: no hace falta preguntar al geocodificador.
    const knownAddress = fixedLocation?.address ?? (nearest?.within ? nearest.location.address : null) ?? null;

    // Retraso: solo al empezar, contra el inicio del turno y pasada la tolerancia de la empresa.
    let lateMinutes: number | null = null;
    if (dto.action === 'START' && currentShift && settings) {
      const late = Math.floor((now.getTime() - currentShift.plannedStart.getTime()) / 60_000);
      if (late > settings.lateToleranceMinutes) lateMinutes = late;
    }

    const newId = randomUUID();
    const closes = dto.action !== 'START';
    const opens = dto.action !== 'STOP';

    let photoKey: string | null = null;
    if (photo && ext) {
      const month = now.toISOString().slice(0, 7).replace('-', '/');
      // Al finalizar, la foto es la evidencia de salida del tramo que se cierra.
      photoKey = `time/${userId}/${month}/${opens ? `${newId}-start` : `${open!.id}-end`}.${ext}`;
      await this.storage.put(photoKey, photo.buffer, imageMime(ext));
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.clockEvent.create({ data: { clientUuid: dto.clientUuid, userId } });
        if (closes) {
          // `endTime: null` en el filtro: si otra petición ya cerró el tramo, esta no hace nada.
          const { count } = await tx.timeEntry.updateMany({
            where: { id: open!.id, endTime: null },
            data: {
              endTime: now,
              clientEndTime: clientTime,
              endLat: pos?.lat ?? null,
              endLng: pos?.lng ?? null,
              endAccuracy: pos?.accuracy ?? null,
              endAddress: knownAddress,
              ...(opens ? {} : { endPhotoKey: photoKey, ...(photoMissing ? { photoMissing: true } : {}) }),
            },
          });
          if (count === 0) throw new ConflictException({ code: 'INVALID_CLOCK_STATE' });
        }
        if (dto.action === 'STOP' && dto.note && ws.organizationId) {
          // La nota queda ligada a la obra o centro en que empezó la jornada: el relevo es de ese sitio.
          const first = await tx.timeEntry.findFirst({ where: { workdayId: open!.workdayId, locationId: { not: null } }, orderBy: { startTime: 'asc' }, select: { locationId: true } });
          await tx.handoverNote.create({
            data: { organizationId: ws.organizationId, authorId: userId, recipientId: dto.note.recipientId, locationId: first?.locationId ?? null, body: dto.note.text, createdAt: now },
          });
        }
        if (dto.action === 'START' && ws.organizationId) {
          // Al empezar se recogen las notas que esperaban: las dirigidas a esta persona y las del turno
          // anterior en su misma ubicación. El filtro `deliveredAt: null` evita que dos personas reciban la misma.
          await tx.handoverNote.updateMany({
            where: {
              organizationId: ws.organizationId,
              deliveredAt: null,
              authorId: { not: userId },
              OR: [
                { recipientId: userId },
                {
                  recipientId: null,
                  createdAt: { gte: new Date(now.getTime() - HANDOVER_OPEN_MS) },
                  ...(locationId ? { OR: [{ locationId: null }, { locationId }] } : {}),
                },
              ],
            },
            data: { deliveredToId: userId, deliveredAt: now },
          });
        }
        if (opens) {
          const entryType =
            dto.action === 'PAUSE' ? (dto.pause === 'TRAVEL' ? ('TRAVEL' as const) : ('BREAK' as const)) : ('WORK' as const);
          await tx.timeEntry.create({
            data: {
              id: newId,
              userId,
              organizationId: ws.organizationId,
              workdayId: open?.workdayId ?? randomUUID(),
              shiftId,
              entryType,
              breakKind: entryType === 'BREAK' ? (dto.pause === 'MEAL' ? 'MEAL' : 'REST') : null,
              startTime: now,
              clientStartTime: clientTime,
              startLat: pos?.lat ?? null,
              startLng: pos?.lng ?? null,
              startAccuracy: pos?.accuracy ?? null,
              locationId,
              isWithinGeofence: within,
              geofenceDistanceMeters: !fixedLocation && nearest && !nearest.within ? nearest.outsideByMeters : null,
              startAddress: knownAddress,
              startPhotoKey: photoKey,
              photoMissing: dto.action === 'START' && photoMissing,
              presenceMethod,
              lateMinutes,
              origin: 'REALTIME',
              syncedOffline: offline,
              clientUuid: dto.clientUuid,
            },
          });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // El mismo evento llegó dos veces a la vez: el otro envío ya lo ha aplicado.
        if (await this.prisma.clockEvent.findUnique({ where: { clientUuid: dto.clientUuid } })) return this.status(userId, ws);
        // Índice único «un tramo abierto por espacio»: dos inicios simultáneos.
        throw new ConflictException({ code: 'INVALID_CLOCK_STATE' });
      }
      throw e;
    }

    if (pos && !knownAddress) void this.resolveAddress(closes ? open!.id : null, opens ? newId : null, pos.lat, pos.lng);
    return this.status(userId, ws);
  }

  // ── Notas de relevo ────────────────────────────────────────────────────

  /** Personas de la empresa a las que se puede dejar una nota: las que fichan, menos uno mismo. */
  async colleagues(userId: string, ws: WorkspaceContext): Promise<PersonRef[]> {
    if (!ws.organizationId) return [];
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: ws.organizationId, active: true, role: { not: 'INSPECTOR' }, userId: { not: userId } },
      select: { user: { select: { id: true, fullName: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return rows.map((m) => m.user);
  }

  /** Notas recibidas al iniciar jornada que siguen sin leer. */
  private async pendingNotes(userId: string, ws: WorkspaceContext): Promise<HandoverNoteDto[]> {
    if (!ws.organizationId) return [];
    const rows = await this.prisma.handoverNote.findMany({
      where: { organizationId: ws.organizationId, deliveredToId: userId, readAt: null },
      include: { author: { select: { id: true, fullName: true } }, location: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    return rows.map((n) => ({ id: n.id, text: n.body, author: n.author, createdAt: n.createdAt.toISOString(), locationName: n.location?.name ?? null, direct: n.recipientId !== null }));
  }

  async readNote(userId: string, ws: WorkspaceContext, id: string): Promise<ClockStatus> {
    const { count } = await this.prisma.handoverNote.updateMany({
      where: { id, deliveredToId: userId, organizationId: ws.organizationId ?? undefined, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0 && !(await this.prisma.handoverNote.findFirst({ where: { id, deliveredToId: userId }, select: { id: true } }))) {
      throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    return this.status(userId, ws);
  }

  /** Las últimas notas que ha dejado esta persona, con su entrega. */
  async sentNotes(userId: string, ws: WorkspaceContext): Promise<SentHandoverNoteDto[]> {
    if (!ws.organizationId) return [];
    const person = { select: { id: true, fullName: true } };
    const rows = await this.prisma.handoverNote.findMany({
      where: { organizationId: ws.organizationId, authorId: userId },
      include: { recipient: person, deliveredTo: person },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return rows.map((n) => ({
      id: n.id,
      text: n.body,
      createdAt: n.createdAt.toISOString(),
      recipient: n.recipient,
      deliveredTo: n.deliveredTo,
      deliveredAt: n.deliveredAt?.toISOString() ?? null,
      readAt: n.readAt?.toISOString() ?? null,
    }));
  }

  /**
   * Geocerca que se aplica a una posición: la ubicación del turno asignado si
   * la tiene; si no, la ubicación más cercana del espacio.
   */
  async geofence(userId: string, ws: WorkspaceContext, pos: PositionQuery, shiftId?: string | null): Promise<GeofenceMatch | undefined> {
    const shift =
      shiftId === undefined
        ? await this.shifts.current(userId, ws, new Date())
        : shiftId
          ? await this.prisma.shift.findUnique({ where: { id: shiftId }, select: { locationId: true } })
          : null;
    if (shift?.locationId) {
      const assigned = (await this.locations.near(userId, ws, pos, 1, shift.locationId))[0];
      if (assigned) return assigned;
    }
    return (await this.locations.near(userId, ws, pos, 1))[0];
  }

  /** La dirección postal se añade después: fichar no espera al geocodificador. */
  private async resolveAddress(closedId: string | null, openedId: string | null, lat: number, lng: number): Promise<void> {
    try {
      const address = await this.geo.reverse(lat, lng, 'es');
      if (!address) return;
      if (closedId) await this.prisma.timeEntry.update({ where: { id: closedId }, data: { endAddress: address } });
      if (openedId) await this.prisma.timeEntry.update({ where: { id: openedId }, data: { startAddress: address } });
    } catch (e) {
      this.log.warn(`No se pudo guardar la dirección del fichaje: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Jornadas del usuario en los últimos `days` días, de la más reciente a la más antigua. */
  async workdays(userId: string, ws: WorkspaceContext, days: number): Promise<WorkdayDto[]> {
    const now = new Date();
    const entries = await this.prisma.timeEntry.findMany({
      where: { ...this.scope(userId, ws), startTime: { gte: new Date(now.getTime() - days * 86_400_000) } },
      include: withLocation,
      orderBy: { startTime: 'asc' },
    });
    return groupWorkdays(entries, now).reverse();
  }

  /** Enlace temporal a la foto de un tramo: su autor o, en una empresa, quien la supervisa. */
  async photoUrl(userId: string, ws: WorkspaceContext, entryId: string, which: 'start' | 'end'): Promise<{ url: string }> {
    const canSupervise = ws.kind === 'organization' && ws.role !== 'EMPLOYEE';
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, organizationId: ws.organizationId, ...(canSupervise ? {} : { userId }) },
      select: { userId: true, startPhotoKey: true, endPhotoKey: true },
    });
    // Quien supervisa con departamentos asignados solo ve a su gente, también aquí.
    if (entry && entry.userId !== userId) await this.visibility.assertVisible(userId, ws, entry.userId);
    const key = which === 'start' ? entry?.startPhotoKey : entry?.endPhotoKey;
    if (!key) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { url: await this.storage.signedUrl(key) };
  }
}
