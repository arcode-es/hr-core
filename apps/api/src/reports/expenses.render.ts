import ExcelJS from 'exceljs';
import { csv, dateTime, EXPENSE_CATEGORY_ES, EXPENSE_STATUS_ES, esDate, money, monthLabel, PAYMENT_ES } from './format';
import { PdfReport } from './pdf-kit';
import type { ExpenseReport, ReportExpense } from './reports.service';

const day = (e: ReportExpense): string => e.date.toISOString().slice(0, 10);
const category = (e: ReportExpense): string => e.customCategory?.name ?? EXPENSE_CATEGORY_ES[e.category] ?? e.category;

interface Totals {
  total: number;
  toReimburse: number;
  reimbursed: number;
  companyCard: number;
  pending: number;
  rejected: number;
}

function totals(expenses: ReportExpense[]): Totals {
  const t: Totals = { total: 0, toReimburse: 0, reimbursed: 0, companyCard: 0, pending: 0, rejected: 0 };
  for (const e of expenses) {
    const amount = Number(e.amount);
    if (e.status === 'REJECTED') t.rejected += amount;
    else {
      t.total += amount;
      if (e.status === 'PENDING') t.pending += amount;
      else if (e.status === 'REIMBURSED') t.reimbursed += amount;
      else if (e.paymentMethod === 'EMPLOYEE_PAID') t.toReimburse += amount;
      else t.companyCard += amount;
    }
  }
  // Sumar importes en coma flotante arrastra decimales espurios (55,099999…).
  for (const k of Object.keys(t) as (keyof Totals)[]) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

const headerFacts = (r: ExpenseReport): [string, string][] => [
  ['Empresa', r.organization?.name ?? 'Registro personal'],
  ['CIF / NIF', r.organization?.taxId ?? '—'],
  ['Trabajador/a', r.person.fullName],
  ['DNI / NIE', r.person.dniNie ?? '—'],
  ['Periodo', monthLabel(r.month)],
  ['Generado', `${dateTime(r.generatedAt, r.timezone)} (${r.timezone})`],
];

/** Liquidación de gastos y dietas del mes, con los tickets en anexo. */
export async function expensesPdf(r: ExpenseReport, photo: (key: string | null) => Promise<Buffer | null>): Promise<Buffer> {
  const doc = await PdfReport.create({
    title: `Liquidación de gastos ${r.month} - ${r.person.fullName}`,
    footer: `HR-Core · ${r.person.fullName} · ${monthLabel(r.month)} · generado el ${dateTime(r.generatedAt, r.timezone)}`,
  });
  await doc.brand(r.brand);
  doc.text('Liquidación de gastos y dietas', { size: 18, bold: true });
  doc.text(monthLabel(r.month), { size: 11 });
  doc.gap(6);
  doc.facts(headerFacts(r));

  const m = (n: number): string => money(n, r.currency);
  const t = totals(r.expenses);
  const receipts: { image: Buffer; caption: string }[] = [];
  const rows: string[][] = [];
  for (const [i, e] of r.expenses.entries()) {
    const image = await photo(e.receiptPhotoKey);
    if (image) receipts.push({ image, caption: `Ticket ${i + 1} · ${esDate(day(e))} · ${e.merchantName ?? category(e)} · ${m(Number(e.amount))}` });
    rows.push([
      String(i + 1),
      esDate(day(e)),
      category(e) + (e.distanceKm ? ` (${Number(e.distanceKm)} km)` : ''),
      [e.merchantName, e.location?.name, e.notes].filter(Boolean).join(' · '),
      PAYMENT_ES[e.paymentMethod] ?? '',
      (EXPENSE_STATUS_ES[e.status] ?? '') + (e.status === 'REJECTED' && e.rejectionReason ? `: ${e.rejectionReason}` : ''),
      e.taxAmount === null ? '' : m(Number(e.taxAmount)),
      m(Number(e.amount)),
      image ? 'Sí' : e.receiptPhotoKey ? 'No disp.' : '—',
    ]);
  }
  if (rows.length === 0) doc.text('No hay gastos registrados en este periodo.', { size: 10 });
  else
    doc.table(
      [
        { header: 'Nº', width: 4, align: 'right' },
        { header: 'Fecha', width: 10 },
        { header: 'Categoría', width: 18 },
        { header: 'Comercio · proyecto · notas', width: 25 },
        { header: 'Pago', width: 11 },
        { header: 'Estado', width: 13 },
        { header: 'IVA', width: 8, align: 'right' },
        { header: 'Importe', width: 10, align: 'right' },
        { header: 'Ticket', width: 6, align: 'center' },
      ],
      rows,
      { size: 7.5 },
    );

  doc.table(
    [
      { header: 'Resumen', width: 70 },
      { header: 'Importe', width: 30, align: 'right' },
    ],
    [
      ['Aprobado y adelantado por el trabajador (pendiente de reembolso)', m(t.toReimburse)],
      ['Ya reembolsado', m(t.reimbursed)],
      ['Pagado con tarjeta de empresa (no se reembolsa)', m(t.companyCard)],
      ['Pendiente de aprobación', m(t.pending)],
      ['Rechazado (no computa)', m(t.rejected)],
      ['Total de gastos del periodo, sin rechazados', m(t.total)],
    ],
    { size: 8.5, emphasizeLast: true },
  );
  doc.signatures('Conforme, la empresa', 'Recibí, el trabajador/a');

  if (receipts.length) {
    doc.addPage();
    doc.text('Anexo: tickets y facturas', { size: 14, bold: true });
    doc.gap(6);
    await doc.gallery(receipts, 2, 340);
  }
  return doc.finish();
}

const HEAD = ['Nº', 'Fecha', 'Categoría', 'Comercio', 'CIF comercio', 'Proyecto / ubicación', 'Forma de pago', 'Estado', 'Motivo de rechazo', 'Km', 'IVA', 'Importe', 'Moneda', 'Ticket adjunto', 'Notas'];

const row = (e: ReportExpense, i: number): (string | number)[] => [
  i + 1,
  esDate(day(e)),
  category(e),
  e.merchantName ?? '',
  e.merchantTaxId ?? '',
  e.location?.name ?? '',
  PAYMENT_ES[e.paymentMethod] ?? '',
  EXPENSE_STATUS_ES[e.status] ?? '',
  e.rejectionReason ?? '',
  e.distanceKm === null ? '' : Number(e.distanceKm),
  e.taxAmount === null ? '' : Number(e.taxAmount),
  Number(e.amount),
  e.currency,
  e.receiptPhotoKey ? 'Sí' : 'No',
  e.notes ?? '',
];

export async function expensesXlsx(r: ExpenseReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR-Core';
  const ws = wb.addWorksheet('Gastos');
  for (const [label, value] of headerFacts(r)) ws.addRow([label, value]).getCell(1).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(HEAD);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1524' } }));
  r.expenses.forEach((e, i) => ws.addRow(row(e, i)));
  const t = totals(r.expenses);
  ws.addRow([]);
  for (const [label, value] of [
    ['Pendiente de reembolso', t.toReimburse],
    ['Ya reembolsado', t.reimbursed],
    ['Tarjeta de empresa', t.companyCard],
    ['Pendiente de aprobación', t.pending],
    ['Rechazado', t.rejected],
    ['Total sin rechazados', t.total],
  ] as const) {
    const added = ws.addRow([label, '', '', '', '', '', '', '', '', '', '', value]);
    added.font = { bold: true };
  }
  [6, 12, 20, 26, 14, 24, 16, 13, 28, 8, 10, 12, 9, 14, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(11).numFmt = '#,##0.00';
  ws.getColumn(12).numFmt = '#,##0.00';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function expensesCsv(r: ExpenseReport): Buffer {
  return csv([['Trabajador/a', r.person.fullName, 'Periodo', monthLabel(r.month)], [], HEAD, ...r.expenses.map(row)]);
}
