import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  type ClockStatus,
  type KioskClockInput,
  type KioskDeviceDto,
  type KioskIdentifyInput,
  type KioskIdentity,
  type KioskInfo,
  type KioskInput,
  type KioskPairingDto,
  type Role,
  resolveSettings,
} from '@hr/shared';
import type { KioskDevice, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomInt } from 'node:crypto';
import { hashToken } from '../auth/auth.service';
import type { WorkspaceContext } from '../common/context';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { type PhotoUpload, TimeService } from '../time/time.service';

/** Validez del código para emparejar una tablet. */
const PAIRING_MINUTES = 15;
/** PIN: intentos fallidos seguidos antes de bloquearlo, y minutos de bloqueo. */
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60_000;
/** Lo que vale la identificación en el quiosco: lo justo para fichar, o para enviar lo guardado sin conexión. */
const IDENTITY_TTL = '12h';
const IDENTITY_MAX_AGE_MS = 8 * 86_400_000;
/** Sin letras ni números que se confundan (O/0, I/1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const include = { location: { select: { id: true, name: true, address: true } } } satisfies Prisma.KioskDeviceInclude;
type Row = Prisma.KioskDeviceGetPayload<{ include: typeof include }>;

const toDto = (k: Row): KioskDeviceDto => ({
  id: k.id,
  name: k.name,
  location: k.location ? { id: k.location.id, name: k.location.name } : null,
  paired: k.tokenHash !== null,
  createdAt: k.createdAt.toISOString(),
  lastSeenAt: k.lastSeenAt?.toISOString() ?? null,
});

interface IdentityClaims {
  sub: string;
  mid: string;
  kid: string;
}

/**
 * Quiosco de fichaje: una tablet compartida donde cada persona ficha con su PIN
 * (y, si quiere, su tarjeta QR). La tablet guarda un token propio, revocable; la
 * identificación de cada persona es otro token, firmado con un secreto distinto
 * al de la sesión para que nunca pueda usarse como acceso a la app.
 */
@Injectable()
export class KioskService {
  private readonly identitySecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly time: TimeService,
    config: ConfigService<Env, true>,
  ) {
    this.identitySecret = `${config.get('JWT_ACCESS_SECRET', { infer: true })}:kiosk-identity`;
  }

  private org(ws: WorkspaceContext): string {
    if (ws.kind !== 'organization') throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
    return ws.organizationId;
  }

  // ── Gestión (administración) ───────────────────────────────────────────

  async list(ws: WorkspaceContext): Promise<KioskDeviceDto[]> {
    const rows = await this.prisma.kioskDevice.findMany({ where: { organizationId: this.org(ws), revokedAt: null }, include, orderBy: { createdAt: 'asc' } });
    return rows.map(toDto);
  }

  async create(ws: WorkspaceContext, dto: KioskInput): Promise<KioskPairingDto> {
    const organizationId = this.org(ws);
    if (dto.locationId) {
      const loc = await this.prisma.location.findFirst({ where: { id: dto.locationId, organizationId }, select: { id: true } });
      if (!loc) throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    const row = await this.prisma.kioskDevice.create({ data: { organizationId, name: dto.name, locationId: dto.locationId ?? null } });
    return this.pairing(ws, row.id);
  }

  /** Código nuevo para emparejar (o volver a emparejar) la tablet. La anterior deja de valer. */
  async pairing(ws: WorkspaceContext, id: string): Promise<KioskPairingDto> {
    const organizationId = this.org(ws);
    const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60_000);
    const { count } = await this.prisma.kioskDevice.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { pairingCodeHash: hashToken(code), pairingExpiresAt: expiresAt, tokenHash: null },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
    const row = await this.prisma.kioskDevice.findUniqueOrThrow({ where: { id }, include });
    return { kiosk: toDto(row), code, expiresAt: expiresAt.toISOString() };
  }

  async revoke(ws: WorkspaceContext, id: string): Promise<void> {
    const { count } = await this.prisma.kioskDevice.updateMany({
      where: { id, organizationId: this.org(ws), revokedAt: null },
      data: { revokedAt: new Date(), tokenHash: null, pairingCodeHash: null },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  // ── PIN y tarjeta de cada persona ──────────────────────────────────────

  /** Cada persona elige su PIN desde la app (nadie más lo conoce). */
  async setPin(ws: WorkspaceContext, pin: string): Promise<void> {
    if (ws.kind !== 'organization') throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
    await this.prisma.membership.update({ where: { id: ws.membershipId }, data: { kioskPinHash: await argon2.hash(pin), kioskPinFailures: 0, kioskLockedUntil: null } });
  }

  async hasPin(ws: WorkspaceContext): Promise<{ set: boolean }> {
    if (ws.kind !== 'organization') return { set: false };
    const m = await this.prisma.membership.findUnique({ where: { id: ws.membershipId }, select: { kioskPinHash: true } });
    return { set: !!m?.kioskPinHash };
  }

  /** La administración puede borrar el PIN de alguien (lo ha olvidado): tendrá que elegir otro. */
  async clearPin(ws: WorkspaceContext, membershipId: string): Promise<void> {
    const { count } = await this.prisma.membership.updateMany({
      where: { id: membershipId, organizationId: this.org(ws) },
      data: { kioskPinHash: null, kioskPinFailures: 0, kioskLockedUntil: null },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  /** Tarjeta QR personal. Generar una nueva invalida la anterior. */
  async card(ws: WorkspaceContext, membershipId: string): Promise<{ code: string; name: string; organization: string }> {
    const organizationId = this.org(ws);
    const m = await this.prisma.membership.findFirst({ where: { id: membershipId, organizationId }, include: { user: { select: { fullName: true } }, organization: { select: { name: true } } } });
    if (!m) throw new NotFoundException({ code: 'NOT_FOUND' });
    const code = randomBytes(18).toString('base64url');
    await this.prisma.membership.update({ where: { id: m.id }, data: { kioskCardCode: code } });
    return { code, name: m.user.fullName, organization: m.organization.name };
  }

  // ── La tablet ──────────────────────────────────────────────────────────

  /** Empareja la tablet con el código que se mostró al crearla. Devuelve su token, una sola vez. */
  async pair(code: string): Promise<{ token: string; info: KioskInfo }> {
    const row = await this.prisma.kioskDevice.findUnique({ where: { pairingCodeHash: hashToken(code) } });
    if (!row || row.revokedAt || !row.pairingExpiresAt || row.pairingExpiresAt < new Date()) throw new UnauthorizedException({ code: 'KIOSK_INVALID' });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.kioskDevice.update({ where: { id: row.id }, data: { tokenHash: hashToken(token), pairingCodeHash: null, pairingExpiresAt: null, lastSeenAt: new Date() } });
    return { token, info: await this.info(row.id) };
  }

  /** Tablet a partir de su token; renueva «visto por última vez» como mucho cada 5 minutos. */
  async device(token: string | undefined): Promise<KioskDevice> {
    if (!token) throw new UnauthorizedException({ code: 'KIOSK_INVALID' });
    const row = await this.prisma.kioskDevice.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.revokedAt) throw new UnauthorizedException({ code: 'KIOSK_INVALID' });
    if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 5 * 60_000) {
      await this.prisma.kioskDevice.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
    }
    return row;
  }

  async info(kioskId: string): Promise<KioskInfo> {
    const k = await this.prisma.kioskDevice.findUniqueOrThrow({ where: { id: kioskId }, include: { ...include, organization: { select: { name: true, settings: true } } } });
    const people = await this.prisma.membership.findMany({
      where: { organizationId: k.organizationId, active: true, role: { not: 'INSPECTOR' } },
      select: { id: true, user: { select: { fullName: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return {
      name: k.name,
      organizationName: k.organization.name,
      locationName: k.location?.name ?? null,
      requirePhoto: resolveSettings(k.organization.settings).requirePhotoOnClock,
      people: people.map((p) => ({ membershipId: p.id, fullName: p.user.fullName })),
    };
  }

  /**
   * Identifica a una persona en la tablet con su PIN (eligiéndola de la lista o con su
   * tarjeta). Tras varios fallos seguidos el PIN se bloquea un rato.
   */
  async identify(kiosk: KioskDevice, dto: KioskIdentifyInput): Promise<KioskIdentity> {
    const m = await this.prisma.membership.findFirst({
      where: { organizationId: kiosk.organizationId, active: true, role: { not: 'INSPECTOR' }, ...(dto.cardCode ? { kioskCardCode: dto.cardCode } : { id: dto.membershipId }) },
      include: { user: { select: { id: true, fullName: true, active: true } } },
    });
    if (!m || !m.user.active) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (!m.kioskPinHash) throw new ConflictException({ code: 'PIN_NOT_SET' });
    if (m.kioskLockedUntil && m.kioskLockedUntil > new Date()) throw new ForbiddenException({ code: 'PIN_LOCKED' });
    if (!(await argon2.verify(m.kioskPinHash, dto.pin))) {
      // Incremento atómico: varios intentos a la vez cuentan todos.
      const { kioskPinFailures } = await this.prisma.membership.update({ where: { id: m.id }, data: { kioskPinFailures: { increment: 1 } }, select: { kioskPinFailures: true } });
      const lock = kioskPinFailures >= PIN_MAX_FAILURES;
      if (lock) await this.prisma.membership.update({ where: { id: m.id }, data: { kioskPinFailures: 0, kioskLockedUntil: new Date(Date.now() + PIN_LOCK_MS) } });
      throw lock ? new ForbiddenException({ code: 'PIN_LOCKED' }) : new UnauthorizedException({ code: 'PIN_INVALID' });
    }
    // El bloqueo pudo activarse mientras se comprobaba este PIN.
    const fresh = await this.prisma.membership.findUnique({ where: { id: m.id }, select: { kioskLockedUntil: true } });
    if (fresh?.kioskLockedUntil && fresh.kioskLockedUntil > new Date()) throw new ForbiddenException({ code: 'PIN_LOCKED' });
    if (m.kioskPinFailures) await this.prisma.membership.update({ where: { id: m.id }, data: { kioskPinFailures: 0 } });
    const token = await this.jwt.signAsync({ sub: m.user.id, mid: m.id, kid: kiosk.id } satisfies IdentityClaims, { secret: this.identitySecret, expiresIn: IDENTITY_TTL });
    const status = await this.time.status(m.user.id, this.workspace(m));
    return { token, fullName: m.user.fullName, state: status.state };
  }

  private workspace(m: { id: string; organizationId: string; role: Role }): WorkspaceContext {
    return { kind: 'organization', organizationId: m.organizationId, role: m.role, membershipId: m.id };
  }

  /** Ficha por la persona identificada, con la ubicación del quiosco como presencia comprobada. */
  async clock(kiosk: KioskDevice, dto: KioskClockInput, photo?: PhotoUpload): Promise<ClockStatus & { fullName: string }> {
    // Un fichaje guardado sin conexión puede llegar cuando la identificación ya ha caducado:
    // vale si el evento ocurrió mientras era válida (y la cola no lo acepta pasada una semana).
    let claims: IdentityClaims & { iat: number; exp: number };
    try {
      claims = await this.jwt.verifyAsync(dto.token, { secret: this.identitySecret, ignoreExpiration: true });
    } catch {
      throw new UnauthorizedException({ code: 'PIN_INVALID' });
    }
    const at = dto.occurredAt ? Date.parse(dto.occurredAt) : Date.now();
    if (at > claims.exp * 1000 + 60_000 || at < claims.iat * 1000 - 60_000 || Date.now() - claims.iat * 1000 > IDENTITY_MAX_AGE_MS) {
      throw new UnauthorizedException({ code: 'PIN_INVALID' });
    }
    if (claims.kid !== kiosk.id) throw new UnauthorizedException({ code: 'PIN_INVALID' });
    const m = await this.prisma.membership.findFirst({
      where: { id: claims.mid, userId: claims.sub, organizationId: kiosk.organizationId, active: true },
      include: { user: { select: { fullName: true } } },
    });
    if (!m) throw new UnauthorizedException({ code: 'PIN_INVALID' });
    const location = kiosk.locationId ? await this.prisma.location.findUnique({ where: { id: kiosk.locationId }, select: { address: true } }) : null;
    const status = await this.time.clock(
      claims.sub,
      this.workspace(m),
      { action: dto.action, pause: dto.pause, position: null, clientTime: dto.clientTime, clientUuid: dto.clientUuid, occurredAt: dto.occurredAt, photoUnavailable: dto.photoUnavailable },
      photo,
      { kiosk: { locationId: kiosk.locationId, address: location?.address ?? null } },
    );
    return { ...status, fullName: m.user.fullName };
  }
}
