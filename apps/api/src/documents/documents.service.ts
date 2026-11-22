import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DocumentDto,
  EMPLOYEE_DOCUMENT_CATEGORIES,
  SendDocumentInput,
  SignatureAudit,
  SignDocumentInput,
} from '@hr/shared';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { RequestMeta, WorkspaceContext } from '../common/context';
import { wallTime } from '../common/tz';
import { ScopeService } from '../common/scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftsService } from '../shifts/shifts.service';
import { Storage } from '../storage/storage';
import { assertSignable, documentKind, KIND_MIME, stampSignature, UnsignableDocumentError } from './signing';

export interface DocumentUpload {
  buffer: Buffer;
  originalName: string;
}

const include = {
  sender: { select: { id: true, fullName: true } },
  recipient: { select: { id: true, fullName: true } },
} satisfies Prisma.DocumentInclude;

type DocumentRow = Prisma.DocumentGetPayload<{ include: typeof include }>;
type OrgWorkspace = Extract<WorkspaceContext, { kind: 'organization' }>;

/** Sigue pendiente: sin firmar (si se pide firma) o sin leer. */
export const isOpen = (d: { requiresSignature: boolean; status: string }): boolean => (d.requiresSignature ? d.status !== 'SIGNED' : d.status === 'SENT');
const today = (): string => new Date().toISOString().slice(0, 10);

const toDto = (d: DocumentRow): DocumentDto => ({
  id: d.id,
  batchId: d.batchId,
  title: d.title,
  category: d.category,
  sender: d.sender,
  recipient: d.recipient,
  fileName: d.originalFileName,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  sha256: d.originalSha256,
  requiresSignature: d.requiresSignature,
  status: d.status,
  createdAt: d.createdAt.toISOString(),
  viewedAt: d.viewedAt?.toISOString() ?? null,
  signedAt: d.signedAt?.toISOString() ?? null,
  audit: d.signatureAudit as SignatureAudit | null,
  dueDate: d.dueDate?.toISOString().slice(0, 10) ?? null,
  overdue: !!d.dueDate && isOpen(d) && d.dueDate.toISOString().slice(0, 10) < today(),
  period: d.period,
});

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
const pad = (n: number): string => String(n).padStart(2, '0');
/** Nombre de archivo sin rutas ni caracteres de control. */
const safeName = (name: string): string => name.replace(/[\\/\u0000-\u001f"]/g, '_').slice(-120) || 'documento';
const manages = (ws: OrgWorkspace): boolean => ws.role === 'ADMIN' || ws.role === 'MANAGER';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly shifts: ShiftsService,
    private readonly notifications: NotificationsService,
    private readonly scope: ScopeService,
  ) {}

  /** Los documentos solo existen dentro de una empresa: siempre hay un emisor y un destinatario. */
  private org(ws: WorkspaceContext): OrgWorkspace {
    if (ws.kind !== 'organization') throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
    return ws;
  }

  /**
   * Envía un documento. Un responsable elige destinatarios (o toda la plantilla)
   * y si exige firma; un empleado solo puede enviar justificantes a sus responsables.
   * El archivo se guarda una vez y se crea una fila por destinatario.
   */
  async send(
    actorId: string,
    workspace: WorkspaceContext,
    dto: SendDocumentInput,
    file: DocumentUpload,
    /**
     * Envíos de la propia empresa (registro mensual, nóminas): `period` es el mes del
     * registro (uno por persona y mes) e `includeSelf` deja que quien envía también reciba el suyo.
     */
    opts: { period?: string; includeSelf?: boolean } = {},
  ): Promise<DocumentDto[]> {
    const ws = this.org(workspace);
    if (ws.role === 'INSPECTOR') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    if (!manages(ws)) {
      const allowed = (EMPLOYEE_DOCUMENT_CATEGORIES as readonly string[]).includes(dto.category);
      if (dto.recipients !== 'MANAGERS' || dto.requiresSignature || !allowed) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }

    const kind = documentKind(file.buffer);
    if (!kind) throw new BadRequestException({ code: 'INVALID_DOCUMENT' });
    if (dto.requiresSignature) {
      await assertSignable(file.buffer, kind).catch(() => {
        throw new BadRequestException({ code: 'INVALID_DOCUMENT' });
      });
    }

    // Un responsable de departamento envía solo a su gente («toda la plantilla» es la suya).
    const visible = dto.recipients === 'MANAGERS' ? {} : await this.scope.userWhere(actorId, ws);
    const r = dto.recipients;
    const members = await this.prisma.membership.findMany({
      where: {
        organizationId: ws.organizationId,
        active: true,
        AND: [opts.includeSelf ? {} : { userId: { not: actorId } }, visible],
        ...(r === 'ALL'
          ? { role: { not: 'INSPECTOR' } }
          : r === 'MANAGERS'
            ? { role: { in: ['ADMIN', 'MANAGER'] } }
            : Array.isArray(r)
              ? { userId: { in: r } }
              : { departmentId: r.departmentId, role: { not: 'INSPECTOR' } }),
      },
      select: { userId: true },
    });
    if (!members.length || (Array.isArray(r) && members.length !== new Set(r).size)) {
      throw new BadRequestException({ code: 'VALIDATION' });
    }

    const batchId = randomUUID();
    const key = `documents/${ws.organizationId}/${batchId}/original.${kind}`;
    await this.storage.put(key, file.buffer, KIND_MIME[kind]);

    const base = {
      organizationId: ws.organizationId,
      senderId: actorId,
      batchId,
      title: dto.title,
      category: dto.category,
      originalFileKey: key,
      originalFileName: safeName(file.originalName),
      mimeType: KIND_MIME[kind],
      sizeBytes: file.buffer.length,
      originalSha256: sha256(file.buffer),
      requiresSignature: dto.requiresSignature,
      dueDate: dto.dueDate ? new Date(`${dto.dueDate}T00:00:00Z`) : null,
      period: opts.period ?? null,
    };
    const rows = await this.prisma.$transaction(
      members.map((m) => this.prisma.document.create({ data: { ...base, recipientId: m.userId }, include })),
    );
    // Cada destinatario recibe el enlace a su propio documento.
    await Promise.all(
      rows.map((d) =>
        this.notifications.notify([d.recipientId], ws.organizationId, 'DOCUMENT_RECEIVED', {
          link: `/documents/${d.id}`,
          title: d.title,
          name: d.sender.fullName,
          requiresSignature: d.requiresSignature,
        }),
      ),
    );
    return rows.map(toDto);
  }

  async inbox(userId: string, workspace: WorkspaceContext): Promise<DocumentDto[]> {
    const ws = this.org(workspace);
    const rows = await this.prisma.document.findMany({
      where: { organizationId: ws.organizationId, recipientId: userId },
      include,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map(toDto);
  }

  /** Lo que he enviado yo; el administrador ve todo lo enviado en la empresa. */
  async sent(userId: string, workspace: WorkspaceContext): Promise<DocumentDto[]> {
    const ws = this.org(workspace);
    const rows = await this.prisma.document.findMany({
      // Lo que otros me enviaron a mí está en mi bandeja de recibidos, no aquí.
      where: { organizationId: ws.organizationId, ...(ws.role === 'ADMIN' ? { NOT: { recipientId: userId, senderId: { not: userId } } } : { senderId: userId }) },
      include,
      orderBy: [{ createdAt: 'desc' }, { recipient: { fullName: 'asc' } }],
      take: 1000,
    });
    return rows.map(toDto);
  }

  async get(userId: string, workspace: WorkspaceContext, id: string): Promise<DocumentDto> {
    return toDto(await this.accessible(userId, this.org(workspace), id));
  }

  /**
   * Contenido del archivo, original o firmado. Cuando el destinatario abre un
   * documento que exige firma, queda registrado como visto.
   */
  async content(
    userId: string,
    workspace: WorkspaceContext,
    id: string,
    which: 'original' | 'signed',
  ): Promise<{ body: Buffer; mimeType: string; fileName: string }> {
    const doc = await this.accessible(userId, this.org(workspace), id);
    const key = which === 'signed' ? doc.signedFileKey : doc.originalFileKey;
    if (!key) throw new NotFoundException({ code: 'NOT_FOUND' });
    const body = await this.storage.get(key);
    if (which === 'original' && doc.recipientId === userId && doc.requiresSignature && doc.status === 'SENT') {
      await this.prisma.document.updateMany({ where: { id, status: 'SENT' }, data: { status: 'VIEWED', viewedAt: new Date() } });
    }
    const signedName = `${doc.originalFileName.replace(/\.[^.]+$/, '')}-firmado.pdf`;
    return { body, mimeType: which === 'signed' ? 'application/pdf' : doc.mimeType, fileName: which === 'signed' ? signedName : doc.originalFileName };
  }

  /** Confirmación de lectura explícita, para documentos que no exigen firma. */
  async acknowledge(userId: string, workspace: WorkspaceContext, id: string): Promise<DocumentDto> {
    const ws = this.org(workspace);
    const { count } = await this.prisma.document.updateMany({
      where: { id, organizationId: ws.organizationId, recipientId: userId, requiresSignature: false, status: 'SENT' },
      data: { status: 'VIEWED', viewedAt: new Date() },
    });
    const doc = await this.accessible(userId, ws, id);
    if (!count && (doc.recipientId !== userId || doc.requiresSignature)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    return toDto(doc);
  }

  /** Firma del destinatario: estampa la rúbrica y el sello de auditoría, y guarda el PDF firmado. */
  async sign(userId: string, workspace: WorkspaceContext, id: string, dto: SignDocumentInput, meta: RequestMeta): Promise<DocumentDto> {
    const ws = this.org(workspace);
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId: ws.organizationId, recipientId: userId, requiresSignature: true } });
    if (!doc) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (doc.status === 'SIGNED') throw new ConflictException({ code: 'ALREADY_SIGNED' });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, dniNie: true } });
    // El sello identifica al firmante por su documento: sin él no se puede firmar.
    if (!user.dniNie?.trim()) throw new BadRequestException({ code: 'DNI_REQUIRED' });

    const original = await this.storage.get(doc.originalFileKey);
    const originalHash = sha256(original);
    // El archivo guardado debe ser exactamente el que se envió.
    if (originalHash !== doc.originalSha256) throw new ConflictException({ code: 'INVALID_DOCUMENT' });

    const { timezone } = await this.shifts.settings(userId, ws);
    const now = new Date();
    const w = wallTime(now, timezone);
    const signaturePng = Buffer.from(dto.signature.slice(dto.signature.indexOf(',') + 1), 'base64');
    const kind = documentKind(original);
    if (!kind) throw new BadRequestException({ code: 'INVALID_DOCUMENT' });

    let signed: Buffer;
    try {
      signed = await stampSignature(original, kind, signaturePng, {
        title: doc.title,
        signerName: user.fullName,
        signerDni: user.dniNie.trim(),
        signedAtLocal: `${pad(w.day)}/${pad(w.month)}/${w.year} ${pad(w.hour)}:${pad(w.minute)} (${timezone})`,
        signedAtUtc: now.toISOString(),
        ip: meta.ip,
        userAgent: meta.userAgent,
        originalSha256: originalHash,
        originalFileName: doc.originalFileName,
      });
    } catch (e) {
      if (e instanceof UnsignableDocumentError) throw new BadRequestException({ code: 'INVALID_DOCUMENT' });
      throw e;
    }

    // Clave única por intento: una petición simultánea que pierda la carrera no pisa el archivo
    // de la que gana, así el PDF guardado es siempre el del hash que consta en la auditoría.
    const signedKey = `documents/${ws.organizationId}/${doc.batchId ?? doc.id}/${doc.id}-signed-${randomBytes(6).toString('hex')}.pdf`;
    await this.storage.put(signedKey, signed, 'application/pdf');
    const audit: SignatureAudit = {
      signerName: user.fullName,
      signerDni: user.dniNie.trim(),
      signedAt: now.toISOString(),
      ip: meta.ip,
      userAgent: meta.userAgent,
      originalSha256: originalHash,
      signedSha256: sha256(signed),
      strokes: dto.strokes,
      points: dto.points,
    };
    // El filtro por estado evita que dos peticiones simultáneas firmen dos veces.
    const { count } = await this.prisma.document.updateMany({
      where: { id, status: { not: 'SIGNED' } },
      data: {
        status: 'SIGNED',
        signedAt: now,
        viewedAt: doc.viewedAt ?? now,
        signedFileKey: signedKey,
        signatureAudit: audit as unknown as Prisma.InputJsonValue,
      },
    });
    if (!count) {
      await this.storage.delete([signedKey]).catch(() => undefined);
      throw new ConflictException({ code: 'ALREADY_SIGNED' });
    }
    await this.notifications.notify([doc.senderId], ws.organizationId, 'DOCUMENT_SIGNED', { link: `/documents/${id}`, title: doc.title, name: user.fullName });
    return toDto(await this.prisma.document.findUniqueOrThrow({ where: { id }, include }));
  }

  /** Retirar un envío: su emisor o el administrador, y solo mientras no esté firmado. */
  async remove(userId: string, workspace: WorkspaceContext, id: string): Promise<void> {
    const ws = this.org(workspace);
    const { count } = await this.prisma.document.deleteMany({
      where: { id, organizationId: ws.organizationId, status: { not: 'SIGNED' }, ...(ws.role === 'ADMIN' ? {} : { senderId: userId }) },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  /** Un documento lo ven su emisor, su destinatario y el administrador de la empresa. */
  private async accessible(userId: string, ws: OrgWorkspace, id: string): Promise<DocumentRow & { signedFileKey: string | null; originalFileKey: string }> {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId: ws.organizationId, ...(ws.role === 'ADMIN' ? {} : { OR: [{ senderId: userId }, { recipientId: userId }] }) },
      include,
    });
    if (!doc) throw new NotFoundException({ code: 'NOT_FOUND' });
    return doc;
  }
}
