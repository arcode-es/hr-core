import { ConflictException, ForbiddenException, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { type GeoNoticeDto, resolveSettings } from '@hr/shared';
import * as argon2 from 'argon2';
import JSZip from 'jszip';
import { randomBytes, randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../common/context';
import { Deployment } from '../deployment/deployment';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { Storage } from '../storage/storage';

/** Nombre de archivo seguro dentro del ZIP. */
const fileName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'archivo';

const ext = (key: string): string => key.slice(key.lastIndexOf('.') + 1) || 'bin';

/**
 * Derechos sobre los propios datos (RGPD) y obligaciones de información y
 * minimización: aviso de geolocalización, exportación, baja y plazo de las fotos.
 */
@Injectable()
export class PrivacyService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly deployment: Deployment,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'conservacion-de-fotos', schedule: { dailyAt: '04:00' }, run: (now) => this.purgeExpiredPhotos(now).then(() => undefined) });
  }

  // ── Aviso de geolocalización (art. 90 LOPDGDD) ─────────────────────────

  async geoNotice(ws: WorkspaceContext): Promise<GeoNoticeDto> {
    if (ws.kind !== 'organization') return { required: false, accepted: true, organizationName: null, companyText: '', photoRetentionMonths: 0 };
    const m = await this.prisma.membership.findUniqueOrThrow({
      where: { id: ws.membershipId },
      include: { organization: { select: { name: true, settings: true } } },
    });
    const settings = resolveSettings(m.organization.settings);
    return {
      required: true,
      accepted: m.geoNoticeAcceptedAt !== null,
      organizationName: m.organization.name,
      companyText: settings.geoNoticeText,
      photoRetentionMonths: settings.photoRetentionMonths,
    };
  }

  /** Deja constancia de que la persona ha recibido el aviso. Se guarda la primera vez. */
  async acceptGeoNotice(ws: WorkspaceContext): Promise<void> {
    if (ws.kind !== 'organization') return;
    await this.prisma.membership.updateMany({ where: { id: ws.membershipId, geoNoticeAcceptedAt: null }, data: { geoNoticeAcceptedAt: new Date() } });
  }

  // ── Exportar mis datos (acceso y portabilidad) ─────────────────────────

  /** ZIP con todos los datos de la persona en JSON y sus archivos: documentos, tickets y fotos de fichaje. */
  async export(userId: string): Promise<{ zip: Buffer; name: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { organization: { select: { name: true } } } } },
    });
    const [entries, expenses, documents, handover] = await Promise.all([
      this.prisma.timeEntry.findMany({
        where: { userId },
        include: { organization: { select: { name: true } }, location: { select: { name: true } } },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.expense.findMany({ where: { userId }, include: { organization: { select: { name: true } } }, orderBy: { date: 'asc' } }),
      this.prisma.document.findMany({ where: { recipientId: userId }, include: { organization: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.handoverNote.findMany({ where: { authorId: userId }, include: { organization: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const space = (o: { name: string } | null): string => o?.name ?? 'Espacio personal';

    const zip = new JSZip();
    const data = {
      generadoEl: new Date().toISOString(),
      perfil: {
        correo: user.email,
        nombre: user.fullName,
        dniNie: user.dniNie,
        telefono: user.phone,
        idioma: user.locale,
        zonaHoraria: user.timezone,
        altaEl: user.createdAt.toISOString(),
      },
      empresas: user.memberships.map((m) => ({
        empresa: m.organization.name,
        rol: m.role,
        puesto: m.jobTitle,
        desde: m.createdAt.toISOString(),
        activa: m.active,
        avisoGeolocalizacionRecibido: m.geoNoticeAcceptedAt?.toISOString() ?? null,
      })),
      fichajes: entries.map((e) => ({
        espacio: space(e.organization),
        jornada: e.workdayId,
        tipo: e.entryType,
        pausa: e.breakKind,
        inicio: e.startTime.toISOString(),
        fin: e.endTime?.toISOString() ?? null,
        origen: e.origin,
        estado: e.approvalStatus,
        anulado: e.voidedAt?.toISOString() ?? null,
        ubicacion: e.location?.name ?? null,
        dentroDelPerimetro: e.isWithinGeofence,
        posicionInicio: e.startLat !== null ? { lat: e.startLat, lng: e.startLng, precisionMetros: e.startAccuracy, direccion: e.startAddress } : null,
        posicionFin: e.endLat !== null ? { lat: e.endLat, lng: e.endLng, precisionMetros: e.endAccuracy, direccion: e.endAddress } : null,
        sinConexion: e.syncedOffline,
        notas: e.notes,
        fotosBorradasPorPlazo: e.photosPurgedAt?.toISOString() ?? null,
      })),
      notasDeRelevo: handover.map((n) => ({ espacio: n.organization.name, fecha: n.createdAt.toISOString(), texto: n.body, entregadaEl: n.deliveredAt?.toISOString() ?? null })),
      gastos: expenses.map((x) => ({
        espacio: space(x.organization),
        fecha: x.date.toISOString().slice(0, 10),
        categoria: x.category,
        importe: Number(x.amount),
        iva: x.taxAmount === null ? null : Number(x.taxAmount),
        moneda: x.currency,
        comercio: x.merchantName,
        kilometros: x.distanceKm === null ? null : Number(x.distanceKm),
        pago: x.paymentMethod,
        estado: x.status,
        motivoRechazo: x.rejectionReason,
        notas: x.notes,
      })),
      documentos: documents.map((d) => ({
        empresa: space(d.organization),
        titulo: d.title,
        categoria: d.category,
        recibido: d.createdAt.toISOString(),
        visto: d.viewedAt?.toISOString() ?? null,
        firmado: d.signedAt?.toISOString() ?? null,
        sha256Original: d.originalSha256,
      })),
    };
    zip.file('datos.json', JSON.stringify(data, null, 2));
    zip.file(
      'LEEME.txt',
      [
        'Tus datos en HR-Core.',
        '',
        'datos.json: perfil, empresas, fichajes (tramos de trabajo, pausas y desplazamientos), gastos y documentos.',
        'documentos/: los documentos que has recibido (firmados, si los firmaste).',
        'tickets/ y fotos-fichaje/: las imágenes que subiste.',
        '',
        'Las horas están en UTC (formato ISO 8601).',
      ].join('\n'),
    );

    const add = async (path: string, key: string | null): Promise<void> => {
      if (!key) return;
      try {
        zip.file(path, await this.storage.get(key));
      } catch {
        // Un archivo que ya no está (p. ej. borrado por plazo) no impide exportar lo demás.
      }
    };
    for (const d of documents) {
      const key = d.signedFileKey ?? d.originalFileKey;
      await add(`documentos/${d.createdAt.toISOString().slice(0, 10)}-${fileName(d.title)}.${ext(key)}`, key);
    }
    for (const x of expenses) await add(`tickets/${x.date.toISOString().slice(0, 10)}-${x.id.slice(0, 8)}.${ext(x.receiptPhotoKey ?? '')}`, x.receiptPhotoKey);
    for (const e of entries) {
      await add(`fotos-fichaje/${e.startTime.toISOString().slice(0, 10)}-${e.id.slice(0, 8)}-entrada.${ext(e.startPhotoKey ?? '')}`, e.startPhotoKey);
      await add(`fotos-fichaje/${e.startTime.toISOString().slice(0, 10)}-${e.id.slice(0, 8)}-salida.${ext(e.endPhotoKey ?? '')}`, e.endPhotoKey);
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { zip: buf, name: `mis-datos-hr-core-${new Date().toISOString().slice(0, 10)}` };
  }

  // ── Baja de la cuenta (supresión) ──────────────────────────────────────

  /**
   * Solo en instalaciones abiertas: en el servidor de un cliente la baja la da la
   * empresa, y en la demo no hay nada que borrar.
   *
   * Si la persona ha trabajado en alguna empresa, su registro de jornada debe
   * conservarse cuatro años (art. 34.9 ET): la cuenta se cierra, se borran los datos
   * de contacto y se conservan nombre y DNI bloqueados para esas empresas. Si solo
   * usó su espacio personal, se borra todo lo que se puede y lo que la ley impide
   * borrar (los tramos de fichaje) queda sin datos que la identifiquen.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    if (this.deployment.mode !== 'open') throw new ForbiddenException({ code: 'ACCOUNT_DELETE_DISABLED' });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, password))) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    // Igual que al quitar el perfil a alguien: una empresa con gente no se queda sin administración.
    const admin = await this.prisma.membership.findMany({ where: { userId, role: 'ADMIN', active: true }, select: { organizationId: true } });
    for (const { organizationId } of admin) {
      const [admins, others] = await Promise.all([
        this.prisma.membership.count({ where: { organizationId, role: 'ADMIN', active: true } }),
        this.prisma.membership.count({ where: { organizationId, active: true, userId: { not: userId } } }),
      ]);
      if (admins <= 1 && others > 0) throw new ConflictException({ code: 'LAST_ADMIN' });
    }
    const worked = (await this.prisma.membership.count({ where: { userId } })) > 0;
    const now = new Date();

    // Archivos personales: fotos de los fichajes y tickets del espacio personal.
    const [entries, expenses] = await Promise.all([
      this.prisma.timeEntry.findMany({ where: { userId, organizationId: null }, select: { startPhotoKey: true, endPhotoKey: true } }),
      this.prisma.expense.findMany({ where: { userId, organizationId: null }, select: { receiptPhotoKey: true } }),
    ]);
    const keys = [...entries.flatMap((e) => [e.startPhotoKey, e.endPhotoKey]), ...expenses.map((x) => x.receiptPhotoKey)].filter((k): k is string => !!k);

    await this.prisma.$transaction([
      this.prisma.timeEntry.updateMany({
        where: { userId, organizationId: null },
        data: { startPhotoKey: null, endPhotoKey: null, startAddress: null, endAddress: null, startLat: null, startLng: null, endLat: null, endLng: null, notes: null, photosPurgedAt: now },
      }),
      this.prisma.expense.deleteMany({ where: { userId, organizationId: null } }),
      this.prisma.location.deleteMany({ where: { userId, organizationId: null } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.pushSubscription.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      this.prisma.membership.updateMany({ where: { userId }, data: { active: false } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `baja-${randomUUID()}@baja.invalid`,
          passwordHash: await argon2.hash(randomBytes(32).toString('base64url')),
          phone: null,
          active: false,
          // Con registros en empresas, nombre y DNI se conservan bloqueados; sin ellos, se borran.
          ...(worked ? {} : { fullName: 'Cuenta eliminada', dniNie: null }),
        },
      }),
    ]);
    if (keys.length) await this.storage.delete(keys).catch(() => undefined);
  }

  // ── Plazo de conservación de las fotos ─────────────────────────────────

  /**
   * Borra las fotos de fichaje más antiguas que el plazo de cada empresa. El tramo
   * (horas, posición, ubicación) se conserva; queda anotado cuándo se borraron.
   */
  async purgeExpiredPhotos(now: Date): Promise<number> {
    const orgs = await this.prisma.organization.findMany({ select: { id: true, settings: true } });
    let purged = 0;
    for (const org of orgs) {
      const months = resolveSettings(org.settings).photoRetentionMonths;
      if (!months) continue;
      const cutoff = new Date(now);
      cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
      for (;;) {
        const batch = await this.prisma.timeEntry.findMany({
          where: { organizationId: org.id, startTime: { lt: cutoff }, OR: [{ startPhotoKey: { not: null } }, { endPhotoKey: { not: null } }] },
          select: { id: true, startPhotoKey: true, endPhotoKey: true },
          take: 500,
        });
        if (!batch.length) break;
        const keys = batch.flatMap((e) => [e.startPhotoKey, e.endPhotoKey]).filter((k): k is string => !!k);
        await this.storage.delete(keys);
        await this.prisma.timeEntry.updateMany({ where: { id: { in: batch.map((e) => e.id) } }, data: { startPhotoKey: null, endPhotoKey: null, photosPurgedAt: now } });
        purged += keys.length;
      }
    }
    return purged;
  }
}
