import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { PayrollAnalysis, PayrollSendInput } from '@hr/shared';
import { PDFDocument } from 'pdf-lib';
import { randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../common/context';
import { findDnis, normalizeDni } from '../common/dni';
import { payslipPdf, textPdf } from '../demo/assets';
import { Deployment } from '../deployment/deployment';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { Storage } from '../storage/storage';
import { DocumentsService } from './documents.service';

/** Lo que se tarda en revisar el reparto: después, el PDF subido se borra. */
const KEEP_MS = 24 * 3_600_000;
const MAX_PAGES = 2000;

/** Texto de cada página del PDF (pdfjs-dist 3.x, la última que se puede cargar con require). */
async function pageTexts(buffer: Buffer): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as typeof import('pdfjs-dist');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  if (pdf.numPages > MAX_PAGES) throw new Error('demasiadas páginas');
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    page.cleanup();
  }
  await pdf.destroy();
  return out;
}

/**
 * Nóminas de toda la plantilla en un solo PDF (como las exporta la gestoría): se
 * lee el DNI/NIE de cada página, se propone a quién va y, una vez revisado, se
 * envía a cada persona un PDF solo con sus páginas.
 */
@Injectable()
export class PayrollService implements OnModuleInit {
  private readonly log = new Logger('Nóminas');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly documents: DocumentsService,
    private readonly jobs: JobsService,
    private readonly deployment: Deployment,
  ) {}

  onModuleInit(): void {
    this.jobs.register({ name: 'limpiar-nominas-subidas', schedule: { everyMinutes: 60 }, run: (now) => this.purgeExpired(now) });
  }

  private admin(ws: WorkspaceContext): string {
    if (ws.kind !== 'organization') throw new ForbiddenException({ code: 'FORBIDDEN_WORKSPACE' });
    if (ws.role !== 'ADMIN') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    return ws.organizationId;
  }

  private async people(organizationId: string) {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId, active: true, role: { not: 'INSPECTOR' } },
      select: { user: { select: { id: true, fullName: true, dniNie: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return rows.map((r) => ({ userId: r.user.id, fullName: r.user.fullName, dniNie: r.user.dniNie ? normalizeDni(r.user.dniNie) : null }));
  }

  async analyze(actorId: string, ws: WorkspaceContext, file: { buffer: Buffer; originalName: string }): Promise<PayrollAnalysis> {
    const organizationId = this.admin(ws);
    if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException({ code: 'PAYROLL_UNREADABLE' });
    let texts: string[];
    try {
      texts = await pageTexts(file.buffer);
    } catch {
      throw new BadRequestException({ code: 'PAYROLL_UNREADABLE' });
    }
    const people = await this.people(organizationId);
    // El DNI lo escribe cada persona en su perfil: si dos lo comparten, no se sabe de quién es la
    // página y se deja sin proponer, para que la administración la asigne a mano.
    const byDni = new Map<string, string>();
    const repeated = new Set<string>();
    for (const p of people) {
      if (!p.dniNie) continue;
      if (byDni.has(p.dniNie)) repeated.add(p.dniNie);
      byDni.set(p.dniNie, p.userId);
    }
    for (const dni of repeated) byDni.delete(dni);

    // De los DNI de la página, el de alguien de la empresa (el de la empresa, un CIF, no cuenta).
    const pages = texts.map((text, i) => {
      const found = findDnis(text);
      const known = found.find((d) => byDni.has(d));
      const dni = known ?? found[0] ?? null;
      return { page: i + 1, dni, userId: dni ? (byDni.get(dni) ?? null) : null };
    });

    const id = randomUUID();
    const fileKey = `tmp/payroll/${organizationId}/${id}.pdf`;
    await this.storage.put(fileKey, file.buffer, 'application/pdf');
    const row = await this.prisma.payrollImport.create({
      data: { id, organizationId, createdById: actorId, fileKey, fileName: file.originalName.slice(-120), pageCount: pages.length, pages, expiresAt: new Date(Date.now() + KEEP_MS) },
    });
    return { id: row.id, fileName: row.fileName, pageCount: row.pageCount, expiresAt: row.expiresAt.toISOString(), pages, people };
  }

  /**
   * Solo en la demo: un PDF de nóminas como el que manda una gestoría (una página por
   * persona con su DNI y una hoja de totales sin dueño), para probar el reparto.
   */
  async sample(ws: WorkspaceContext): Promise<Buffer> {
    const organizationId = this.admin(ws);
    if (!this.deployment.isDemo) throw new NotFoundException({ code: 'NOT_FOUND' });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, taxId: true } });
    const month = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date());
    const out = await PDFDocument.create();
    out.setTitle(`Nóminas ${month}`);
    const add = async (bytes: Buffer): Promise<void> => {
      const doc = await PDFDocument.load(bytes);
      for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
    };
    const people = (await this.people(organizationId)).filter((p) => p.dniNie);
    for (const [i, p] of people.entries()) {
      const gross = 1900 + i * 160;
      await add(await payslipPdf({ company: org.name, taxId: org.taxId ?? '', name: p.fullName, dni: p.dniNie!, month, gross, net: Math.round(gross * 0.8 * 100) / 100 }));
    }
    await add(await textPdf('Resumen de costes de la empresa', `${org.name} · ${month}`, ['Totales de la plantilla, cotizaciones a cargo de la empresa y retenciones. Esta hoja no es de ninguna persona: no se envía.']));
    return Buffer.from(await out.save());
  }

  private async load(organizationId: string, id: string) {
    const row = await this.prisma.payrollImport.findFirst({ where: { id, organizationId, expiresAt: { gt: new Date() } } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND' });
    return row;
  }

  /** Un PDF por persona con sus páginas, en el orden del original. */
  async send(actorId: string, ws: WorkspaceContext, id: string, dto: PayrollSendInput): Promise<{ sent: number }> {
    const organizationId = this.admin(ws);
    const row = await this.load(organizationId, id);
    const members = new Set((await this.people(organizationId)).map((p) => p.userId));
    const byUser = new Map<string, number[]>();
    const used = new Set<number>();
    for (const a of dto.assignments) {
      if (a.page > row.pageCount || used.has(a.page) || !members.has(a.userId)) throw new BadRequestException({ code: 'VALIDATION' });
      used.add(a.page);
      byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a.page]);
    }

    const source = await PDFDocument.load(await this.storage.get(row.fileKey), { ignoreEncryption: true });
    let sent = 0;
    for (const [userId, pages] of byUser) {
      const out = await PDFDocument.create();
      out.setTitle(dto.title);
      const copied = await out.copyPages(source, pages.sort((a, b) => a - b).map((p) => p - 1));
      copied.forEach((p) => out.addPage(p));
      const buffer = Buffer.from(await out.save());
      await this.documents.send(
        actorId,
        ws,
        { title: dto.title, category: 'PAYROLL', requiresSignature: false, recipients: [userId] },
        { buffer, originalName: `${dto.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || 'nomina'}.pdf` },
        { includeSelf: true },
      );
      sent++;
    }
    await this.discard(actorId, ws, id);
    return { sent };
  }

  async discard(_actorId: string, ws: WorkspaceContext, id: string): Promise<void> {
    const organizationId = this.admin(ws);
    const row = await this.prisma.payrollImport.findFirst({ where: { id, organizationId } });
    if (!row) return;
    await this.prisma.payrollImport.delete({ where: { id } });
    await this.storage.delete([row.fileKey]).catch(() => undefined);
  }

  async purgeExpired(now: Date): Promise<void> {
    const rows = await this.prisma.payrollImport.findMany({ where: { expiresAt: { lt: now } }, select: { id: true, fileKey: true } });
    if (!rows.length) return;
    await this.prisma.payrollImport.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await this.storage.delete(rows.map((r) => r.fileKey)).catch((e: unknown) => this.log.warn(`No se pudieron borrar nóminas subidas: ${String(e)}`));
  }
}
