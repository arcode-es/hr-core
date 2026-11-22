import type { ExpenseCategoryId, ExpenseDto } from '@hr/shared';
import { BedDouble, CircleEllipsis, Fuel, Gauge, type LucideIcon, ParkingSquare, Utensils, Wrench } from 'lucide-react';

export const CATEGORY_ICON: Record<ExpenseCategoryId, LucideIcon> = {
  MEAL: Utensils,
  FUEL: Fuel,
  TOLL: ParkingSquare,
  LODGING: BedDouble,
  MATERIAL: Wrench,
  MILEAGE: Gauge,
  OTHER: CircleEllipsis,
};

/** Color fijo por categoría, para reconocer el tipo de gasto de un vistazo en la lista. */
export const CATEGORY_COLOR: Record<ExpenseCategoryId, string> = {
  MEAL: '#d97706',
  FUEL: '#dc2626',
  TOLL: '#0891b2',
  LODGING: '#9333ea',
  MATERIAL: '#4f46e5',
  MILEAGE: '#0c8f63',
  OTHER: '#64748b',
};

export const STATUS_TONE: Record<ExpenseDto['status'], 'warning' | 'accent' | 'danger' | 'success'> = {
  PENDING: 'warning',
  APPROVED: 'accent',
  REJECTED: 'danger',
  REIMBURSED: 'success',
};

export function formatMoney(amount: number, currency: string, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

/** "12,50" o "12.50" → 12.5; NaN si no es un importe. */
export function parseAmount(text: string): number {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() === '' ? NaN : Math.round(n * 100) / 100;
}
