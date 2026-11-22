import type { PayrollColumn, SiteCostReport } from '@hr/shared';
import ExcelJS from 'exceljs';
import { csv, EXPENSE_CATEGORY_ES, hoursDecimal, monthLabel } from './format';
import type { PayrollRow } from './management.service';

export const PAYROLL_COLUMN_ES: Record<PayrollColumn, string> = {
  dni: 'DNI/NIE',
  name: 'Nombre y apellidos',
  department: 'Departamento',
  jobTitle: 'Puesto',
  workedDays: 'Días trabajados',
  workedHours: 'Horas trabajadas',
  ordinaryHours: 'Horas ordinarias',
  overtimeHours: 'Horas extra',
  nightHours: 'Horas nocturnas',
  travelHours: 'Horas de desplazamiento',
  plannedHours: 'Horas planificadas',
  vacationDays: 'Días de vacaciones',
  sickDays: 'Días de baja',
  otherAbsenceDays: 'Otras ausencias (días)',
  lateCount: 'Retrasos',
  expenses: 'Gastos aprobados (€)',
  mileageKm: 'Kilometraje (km)',
  mileageAmount: 'Kilometraje (€)',
};

const TEXT: PayrollColumn[] = ['dni', 'name', 'department', 'jobTitle'];

export async function payrollXlsx(p: { organization: string; month: string; columns: PayrollColumn[]; rows: PayrollRow[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR-Core';
  const ws = wb.addWorksheet('Gestoría');
  ws.addRow([p.organization]).font = { bold: true, size: 14 };
  ws.addRow([`Datos para nómina de ${monthLabel(p.month)}`]);
  ws.addRow([]);
  const head = ws.addRow(p.columns.map((c) => PAYROLL_COLUMN_ES[c]));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1524' } }));
  for (const r of p.rows) ws.addRow(p.columns.map((c) => r[c]));
  p.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c === 'name' ? 30 : TEXT.includes(c) ? 18 : 14;
    if (!TEXT.includes(c)) col.numFmt = c.endsWith('Days') || c === 'lateCount' ? '0.##' : '0.00';
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.addRow([]);
  ws.addRow(['Horas y ausencias de jornadas aprobadas. Gastos aprobados o ya pagados del mes. Generado con HR-Core.']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV con «;» (Excel en español) y protección contra fórmulas. */
export function payrollCsv(p: { columns: PayrollColumn[]; rows: PayrollRow[] }): Buffer {
  return csv([p.columns.map((c) => PAYROLL_COLUMN_ES[c]), ...p.rows.map((r) => p.columns.map((c) => r[c]))]);
}

export async function sitesXlsx(r: SiteCostReport, organization: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HR-Core';
  const ws = wb.addWorksheet('Coste por obra');
  ws.addRow([organization]).font = { bold: true, size: 14 };
  ws.addRow([`Coste por obra de ${monthLabel(r.month)}`]);
  ws.addRow([]);
  const cats = [...new Set(r.rows.flatMap((x) => Object.keys(x.expenses)))].sort();
  const head = ws.addRow(['Ubicación', 'Horas', 'Personas', `Coste estimado de las horas (${r.currency})`, ...cats.map((c) => `${EXPENSE_CATEGORY_ES[c] ?? c} (${r.currency})`), `Total gastos (${r.currency})`, `Total (${r.currency})`]);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1524' } }));
  for (const x of r.rows) {
    ws.addRow([x.location?.name ?? 'Sin ubicación', hoursDecimal(x.workedSeconds), x.people, x.laborCost, ...cats.map((c) => x.expenses[c as keyof typeof x.expenses] ?? 0), x.expensesTotal, Math.round((x.laborCost + x.expensesTotal) * 100) / 100]);
  }
  const total = ws.addRow(['Total', hoursDecimal(r.total.workedSeconds), '', r.total.laborCost, ...cats.map(() => ''), r.total.expensesTotal, Math.round((r.total.laborCost + r.total.expensesTotal) * 100) / 100]);
  total.font = { bold: true };
  ws.getColumn(1).width = 32;
  for (let c = 2; c <= 6 + cats.length; c++) {
    ws.getColumn(c).width = 18;
    ws.getColumn(c).numFmt = c === 3 ? '0' : '#,##0.00';
  }
  if (r.missingRates.length) {
    ws.addRow([]);
    ws.addRow([`Sin coste por hora (su coste no se cuenta): ${r.missingRates.map((p) => p.fullName).join(', ')}`]);
  }
  ws.addRow([]);
  ws.addRow(['Estimación: horas aprobadas por el coste por hora de cada persona, con el recargo de las extra. Gastos aprobados o pagados imputados a la ubicación.']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
