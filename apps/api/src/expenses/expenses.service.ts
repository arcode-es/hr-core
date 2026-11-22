import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CustomCategoryDto,
  ExpenseConfig,
  ExpenseDto,
  ExpenseInput,
  ExpenseSummaryRow,
  OcrSuggestion,
  ReviewInput,
} from '@hr/shared';
import { Expense, ExpenseStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { WorkspaceContext } from '../common/context';
import { imageExtension, imageMime } from '../common/images';
import { localDate } from '../common/tz';
import { NotificationsService } from '../notifications/notifications.service';
import { OcrProvider } from '../ocr/ocr.provider';
import { ScopeService } from '../common/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftsService } from '../shifts/shifts.service';
import { Storage } from '../storage/storage';

export interface ReceiptUpload {
  buffer: Buffer;
}

const include = {
  user: { select: { id: true, fullName: true } },
  location: { select: { name: true } },
  customCategory: { select: { name: true } },
  reviewedBy: { select: { fullName: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof include }>;

const toDto = (e: ExpenseRow): ExpenseDto => ({
  id: e.id,
  user: e.user,
  category: e.category,
  customCategoryId: e.customCategoryId,
  customCategoryName: e.customCategory?.name ?? null,
  amount: Number(e.amount),
  taxAmount: e.taxAmount === null ? null : Number(e.taxAmount),
  currency: e.currency,
  date: e.date.toISOString().slice(0, 10),
  merchantName: e.merchantName,
  merchantTaxId: e.merchantTaxId,
  paymentMethod: e.paymentMethod,
  distanceKm: e.distanceKm === null ? null : Number(e.distanceKm),
  locationId: e.locationId,
  locationName: e.location?.name ?? null,
  notes: e.notes,
  status: e.status,
  rejectionReason: e.rejectionReason,
  hasReceipt: e.receiptPhotoKey !== null,
  reviewedBy: e.reviewedBy?.fullName ?? null,
  reimbursedAt: e.reimbursedAt?.toISOString() ?? null,
});

const day = (date: string): Date => new Date(`${date}T00:00:00Z`);
const round2 = (n: number): number => Math.round(n * 100) / 100;
const canReview = (ws: WorkspaceContext): boolean => ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');
const canSeeTeam = (ws: WorkspaceContext): boolean => ws.kind === 'organization' && ws.role !== 'EMPLOYEE';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly ocr: OcrProvider,
    private readonly shifts: ShiftsService,
    private readonly notifications: NotificationsService,
    private readonly scope: ScopeService,
  ) {}

  async config(userId: string, ws: WorkspaceContext): Promise<ExpenseConfig> {
    const settings = await this.shifts.settings(userId, ws);
    return { currency: settings.currency, mileageRatePerKm: settings.mileageRatePerKm, customCategories: await this.categories(ws) };
  }

  /** Propuesta de datos a partir de la foto. Nunca bloquea: si el proveedor falla, no hay propuesta. */
  async suggest(photo: ReceiptUpload): Promise<OcrSuggestion> {
    const ext = imageExtension(photo.buffer);
    if (!ext) throw new BadRequestException({ code: 'INVALID_PHOTO' });
    try {
      return await this.ocr.extract(photo.buffer, imageMime(ext));
    } catch {
      return { provider: this.ocr.name, amount: null, taxAmount: null, date: null, merchantName: null, merchantTaxId: null };
    }
  }

  // ── Gastos propios ─────────────────────────────────────────────────────

  async list(userId: string, ws: WorkspaceContext, from: string, to: string): Promise<ExpenseDto[]> {
    const rows = await this.prisma.expense.findMany({
      where: { userId, organizationId: ws.organizationId, date: { gte: day(from), lte: day(to) } },
      include,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toDto);
  }

  async create(userId: string, ws: WorkspaceContext, dto: ExpenseInput, photo?: ReceiptUpload): Promise<ExpenseDto> {
    if (ws.kind === 'organization' && ws.role === 'INSPECTOR') throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    if (dto.clientUuid) {
      // Reenvío desde la cola sin conexión: devuelve el gasto ya creado.
      const existing = await this.prisma.expense.findUnique({ where: { clientUuid: dto.clientUuid }, include });
      if (existing) {
        if (existing.userId !== userId) throw new ConflictException({ code: 'OVERLAP' });
        return toDto(existing);
      }
    }
    const id = randomUUID();
    const data = await this.fields(userId, ws, dto);
    const receiptPhotoKey = photo ? await this.saveReceipt(userId, id, dto.date, photo) : null;
    // Sin nadie que valide (espacio personal) o siendo administrador, el gasto queda aprobado.
    const autoApproved = ws.kind === 'personal' || ws.role === 'ADMIN';
    const row = await this.prisma.expense.create({
      data: {
        ...data,
        id,
        userId,
        organizationId: ws.organizationId,
        receiptPhotoKey,
        clientUuid: dto.clientUuid ?? null,
        ocrData: (dto.ocrData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        status: autoApproved ? 'APPROVED' : 'PENDING',
      },
      include,
    });
    if (row.status === 'PENDING' && ws.kind === 'organization') await this.notifyPending(row, ws.organizationId);
    return toDto(row);
  }

  /** Solo su autor, y solo mientras está pendiente o rechazado. Corregir uno rechazado lo vuelve a enviar. */
  async update(userId: string, ws: WorkspaceContext, id: string, dto: ExpenseInput, photo?: ReceiptUpload): Promise<ExpenseDto> {
    const existing = await this.own(userId, ws, id);
    this.assertEditable(existing);
    const data = await this.fields(userId, ws, dto);
    const receiptPhotoKey = photo ? await this.saveReceipt(userId, id, dto.date, photo) : undefined;
    // La condición de estado va en la propia escritura: si lo aprueban mientras tanto, no se toca.
    const { count } = await this.prisma.expense.updateMany({
      where: { id, userId, status: { in: ['PENDING', 'REJECTED'] } },
      data: {
        ...data,
        ...(receiptPhotoKey ? { receiptPhotoKey } : {}),
        ...(existing.status === 'REJECTED' ? { status: 'PENDING', rejectionReason: null, reviewedById: null, reviewedAt: null } : {}),
      },
    });
    if (!count) throw new ConflictException({ code: 'EXPENSE_LOCKED' });
    const row = await this.prisma.expense.findUniqueOrThrow({ where: { id }, include });
    // Un gasto rechazado que se corrige vuelve a la bandeja de quien aprueba.
    if (existing.status === 'REJECTED' && ws.kind === 'organization') await this.notifyPending(row, ws.organizationId);
    return toDto(row);
  }

  async remove(userId: string, ws: WorkspaceContext, id: string): Promise<void> {
    const existing = await this.own(userId, ws, id);
    this.assertEditable(existing);
    const { count } = await this.prisma.expense.deleteMany({ where: { id, userId, status: { in: ['PENDING', 'REJECTED'] } } });
    if (!count) throw new ConflictException({ code: 'EXPENSE_LOCKED' });
  }

  /** Enlace temporal al ticket: su autor o quien supervisa la empresa. */
  async receiptUrl(userId: string, ws: WorkspaceContext, id: string): Promise<{ url: string }> {
    const row = await this.prisma.expense.findFirst({
      where: { id, organizationId: ws.organizationId, ...(canSeeTeam(ws) ? await this.scope.userWhere(userId, ws) : { userId }) },
      select: { receiptPhotoKey: true },
    });
    if (!row?.receiptPhotoKey) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { url: await this.storage.signedUrl(row.receiptPhotoKey) };
  }

  // ── Aprobación y liquidación ───────────────────────────────────────────

  async team(actorId: string, ws: WorkspaceContext, from: string, to: string, status?: ExpenseStatus): Promise<ExpenseDto[]> {
    const rows = await this.prisma.expense.findMany({
      where: { organizationId: ws.organizationId, date: { gte: day(from), lte: day(to) }, ...(status ? { status } : {}), ...(await this.scope.userWhere(actorId, ws)) },
      include,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toDto);
  }

  async pending(actorId: string, ws: WorkspaceContext): Promise<ExpenseDto[]> {
    const rows = await this.prisma.expense.findMany({
      where: { organizationId: ws.organizationId, status: 'PENDING', ...(await this.scope.userWhere(actorId, ws)) },
      include,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  /** Aprueba o rechaza. Nadie valida sus propios gastos. */
  async review(actorId: string, ws: WorkspaceContext, id: string, dto: ReviewInput): Promise<ExpenseDto> {
    if (!canReview(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const approve = dto.decision === 'APPROVE';
    // El filtro por estado en la propia escritura evita dos decisiones simultáneas.
    const { count } = await this.prisma.expense.updateMany({
      where: { id, organizationId: ws.organizationId, status: 'PENDING', AND: [{ userId: { not: actorId } }, await this.scope.userWhere(actorId, ws)] },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewedById: actorId,
        reviewedAt: new Date(),
        rejectionReason: approve ? null : dto.reason!.trim(),
      },
    });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
    const row = await this.prisma.expense.findUniqueOrThrow({ where: { id }, include });
    await this.notifications.notify([row.userId], ws.organizationId, 'EXPENSE_REVIEWED', { link: '/expenses', approved: approve, amount: this.money(row) });
    return toDto(row);
  }

  /** Marca como pagado todo lo aprobado y adelantado por una persona en el periodo. */
  async reimburse(actorId: string, ws: WorkspaceContext, userId: string, from: string, to: string): Promise<{ reimbursed: number; amount: number }> {
    if (!canReview(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    await this.scope.assertVisible(actorId, ws, userId);
    return this.prisma.$transaction(async (tx) => {
      const where: Prisma.ExpenseWhereInput = {
        organizationId: ws.organizationId,
        userId,
        status: 'APPROVED',
        paymentMethod: 'EMPLOYEE_PAID',
        date: { gte: day(from), lte: day(to) },
      };
      const sum = await tx.expense.aggregate({ where, _sum: { amount: true } });
      const { count } = await tx.expense.updateMany({ where, data: { status: 'REIMBURSED', reimbursedAt: new Date() } });
      return { reimbursed: count, amount: Number(sum._sum.amount ?? 0) };
    });
  }

  /** Liquidación del periodo: una fila por persona con gastos. Sin supervisar, solo la propia. */
  async summary(userId: string, ws: WorkspaceContext, from: string, to: string): Promise<ExpenseSummaryRow[]> {
    const groups = await this.prisma.expense.groupBy({
      by: ['userId', 'status', 'paymentMethod'],
      where: { organizationId: ws.organizationId, date: { gte: day(from), lte: day(to) }, ...(canSeeTeam(ws) ? await this.scope.userWhere(userId, ws) : { userId }) },
      _sum: { amount: true },
      _count: true,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set([userId, ...groups.map((g) => g.userId)])] } },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    return users
      .map((user) => {
        const row: ExpenseSummaryRow = { user, count: 0, pending: 0, toReimburse: 0, reimbursed: 0, companyCard: 0, rejected: 0 };
        for (const g of groups.filter((x) => x.userId === user.id)) {
          const amount = Number(g._sum.amount ?? 0);
          row.count += g._count;
          if (g.status === 'PENDING') row.pending += amount;
          else if (g.status === 'REJECTED') row.rejected += amount;
          else if (g.status === 'REIMBURSED') row.reimbursed += amount;
          else if (g.paymentMethod === 'EMPLOYEE_PAID') row.toReimburse += amount;
          else row.companyCard += amount;
        }
        for (const k of ['pending', 'toReimburse', 'reimbursed', 'companyCard', 'rejected'] as const) row[k] = round2(row[k]);
        return row;
      })
      .filter((r) => r.count > 0 || r.user.id === userId);
  }

  // ── Categorías propias de la empresa ───────────────────────────────────

  async categories(ws: WorkspaceContext): Promise<CustomCategoryDto[]> {
    if (ws.kind !== 'organization') return [];
    const rows = await this.prisma.customExpenseCategory.findMany({ where: { organizationId: ws.organizationId }, orderBy: { name: 'asc' } });
    return rows.map((c) => ({ id: c.id, name: c.name, baseCategory: c.baseCategory, isActive: c.isActive }));
  }

  async createCategory(ws: WorkspaceContext, name: string, baseCategory: CustomCategoryDto['baseCategory']): Promise<CustomCategoryDto> {
    if (!canReview(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    try {
      const c = await this.prisma.customExpenseCategory.create({ data: { organizationId: ws.organizationId!, name, baseCategory } });
      return { id: c.id, name: c.name, baseCategory: c.baseCategory, isActive: c.isActive };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'OVERLAP' });
      throw e;
    }
  }

  async setCategoryActive(ws: WorkspaceContext, id: string, isActive: boolean): Promise<void> {
    if (!canReview(ws)) throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    const { count } = await this.prisma.customExpenseCategory.updateMany({ where: { id, organizationId: ws.organizationId! }, data: { isActive } });
    if (!count) throw new NotFoundException({ code: 'NOT_FOUND' });
  }

  // ── Internos ───────────────────────────────────────────────────────────

  private money(e: { amount: Prisma.Decimal; currency: string }): string {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: e.currency }).format(Number(e.amount)).replace(/\u00A0/g, ' ');
  }

  private async notifyPending(row: ExpenseRow, organizationId: string): Promise<void> {
    await this.notifications.notify(await this.notifications.supervisors(organizationId, row.userId), organizationId, 'EXPENSE_PENDING', {
      link: '/expenses',
      name: row.user.fullName,
      amount: this.money(row),
    });
  }

  private async own(userId: string, ws: WorkspaceContext, id: string): Promise<Expense> {
    const row = await this.prisma.expense.findFirst({ where: { id, userId, organizationId: ws.organizationId } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND' });
    return row;
  }

  /** Un gasto ya aprobado o pagado forma parte de la contabilidad: no se toca. */
  private assertEditable(e: Expense): void {
    if (e.status === 'APPROVED' || e.status === 'REIMBURSED') throw new ConflictException({ code: 'EXPENSE_LOCKED' });
  }

  private async fields(userId: string, ws: WorkspaceContext, dto: ExpenseInput) {
    const settings = await this.shifts.settings(userId, ws);
    // No se admiten gastos con fecha posterior a hoy (hora de la empresa).
    if (dto.date > localDate(new Date(), settings.timezone)) throw new BadRequestException({ code: 'INVALID_RANGE' });

    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({
        where: { id: dto.locationId, ...(ws.kind === 'organization' ? { organizationId: ws.organizationId } : { organizationId: null, userId }) },
        select: { id: true },
      });
      if (!location) throw new NotFoundException({ code: 'NOT_FOUND' });
    }
    let category = dto.category;
    if (dto.customCategoryId) {
      const custom = await this.prisma.customExpenseCategory.findFirst({
        where: { id: dto.customCategoryId, organizationId: ws.organizationId ?? undefined, isActive: true },
      });
      if (!custom || ws.kind !== 'organization') throw new NotFoundException({ code: 'NOT_FOUND' });
      category = custom.baseCategory;
    }

    const mileage = category === 'MILEAGE';
    return {
      category,
      customCategoryId: dto.customCategoryId ?? null,
      // Kilometraje: el importe lo fija el servidor con la tarifa de la empresa.
      amount: mileage ? round2(dto.distanceKm! * settings.mileageRatePerKm) : dto.amount!,
      taxAmount: mileage ? null : (dto.taxAmount ?? null),
      currency: settings.currency,
      date: day(dto.date),
      merchantName: dto.merchantName ?? null,
      merchantTaxId: dto.merchantTaxId ?? null,
      // Con vehículo propio siempre adelanta el empleado.
      paymentMethod: mileage ? ('EMPLOYEE_PAID' as const) : dto.paymentMethod,
      distanceKm: mileage ? dto.distanceKm! : null,
      locationId: dto.locationId ?? null,
      notes: dto.notes ?? null,
    };
  }

  private async saveReceipt(userId: string, expenseId: string, date: string, photo: ReceiptUpload): Promise<string> {
    const ext = imageExtension(photo.buffer);
    if (!ext) throw new BadRequestException({ code: 'INVALID_PHOTO' });
    // Nombre nuevo en cada subida: sustituir el ticket no pisa el archivo anterior.
    const key = `expenses/${userId}/${date.slice(0, 4)}/${date.slice(5, 7)}/${expenseId}-${randomUUID().slice(0, 8)}.${ext}`;
    await this.storage.put(key, photo.buffer, imageMime(ext));
    return key;
  }
}
