const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) cache.set(key, (f = new Intl.DateTimeFormat('es-ES', { timeZone: tz, ...options })));
  return f;
}

export const hhmm = (d: Date, tz: string): string => fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
export const hhmmss = (d: Date, tz: string): string => fmt(tz, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
export const dateTime = (d: Date, tz: string): string =>
  fmt(tz, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

/** "2026-11-10" → "mar 10". */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' }).format(d).replace('.', '');
  return `${weekday} ${d.getUTCDate()}`;
}

/** "2026-11" → "noviembre de 2026". */
export const monthLabel = (month: string): string =>
  new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));

export const esDate = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** 27000 → "7:30". Vacío si es cero, para que la tabla respire. */
export function hm(seconds: number, blankZero = true): string {
  if (seconds <= 0) return blankZero ? '' : '0:00';
  const m = Math.round(seconds / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Horas decimales para hojas de cálculo. */
export const hoursDecimal = (seconds: number): number => Math.round((seconds / 3600) * 100) / 100;

export const money = (n: number, currency: string): string => new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(n);

export const coords = (lat: number | null, lng: number | null, accuracy: number | null): string =>
  lat === null || lng === null ? 'sin posición' : `${lat.toFixed(6)}, ${lng.toFixed(6)}${accuracy !== null ? ` (±${Math.round(accuracy)} m)` : ''}`;

/** CSV con punto y coma y BOM: se abre bien en un Excel en español. */
export function csv(rows: (string | number)[][]): Buffer {
  const cell = (v: string | number): string => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
    // Neutraliza fórmulas: una celda que empieza por = + - @ no debe ejecutarse al abrir el archivo.
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v !== 'number' ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return Buffer.from('﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n', 'utf8');
}

export const EXPENSE_CATEGORY_ES: Record<string, string> = {
  MEAL: 'Comida',
  FUEL: 'Combustible',
  TOLL: 'Peaje / Parking',
  LODGING: 'Alojamiento',
  MATERIAL: 'Material',
  MILEAGE: 'Kilometraje',
  OTHER: 'Otros',
};
export const EXPENSE_STATUS_ES: Record<string, string> = { PENDING: 'Pendiente', APPROVED: 'Aprobado', REJECTED: 'Rechazado', REIMBURSED: 'Pagado' };
export const PAYMENT_ES: Record<string, string> = { EMPLOYEE_PAID: 'Adelantado', COMPANY_CARD: 'Tarjeta empresa' };
export const SEGMENT_ES = (type: string, breakKind: string | null): string =>
  type === 'WORK' ? 'Trabajo' : type === 'TRAVEL' ? 'Desplazamiento' : breakKind === 'MEAL' ? 'Pausa (comida)' : 'Pausa (descanso)';
