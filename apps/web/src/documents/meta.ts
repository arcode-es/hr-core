import type { DocumentCategoryId, DocumentDto } from '@hr/shared';
import { Award, Banknote, ClipboardCheck, FileSignature, FileText, HardHat, type LucideIcon, Megaphone, Stethoscope } from 'lucide-react';

export const DOC_ICON: Record<DocumentCategoryId, LucideIcon> = {
  PAYROLL: Banknote,
  CONTRACT: FileSignature,
  SAFETY: HardHat,
  CERTIFICATE: Award,
  ANNOUNCEMENT: Megaphone,
  MEDICAL_LEAVE: Stethoscope,
  TIMESHEET: ClipboardCheck,
  OTHER: FileText,
};

export type DocState = 'toSign' | 'toRead' | 'read' | 'signed';

/** Estado de cara al usuario: distingue lo que aún pide una acción de lo ya hecho. */
export function docState(d: DocumentDto): DocState {
  if (d.status === 'SIGNED') return 'signed';
  if (d.requiresSignature) return 'toSign';
  return d.status === 'VIEWED' ? 'read' : 'toRead';
}

export const STATE_TONE: Record<DocState, 'warning' | 'accent' | 'neutral' | 'success'> = {
  toSign: 'warning',
  toRead: 'accent',
  read: 'neutral',
  signed: 'success',
};

export function formatBytes(n: number, locale: string | undefined): string {
  const f = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return n < 1024 * 1024 ? `${f.format(Math.max(1, Math.round(n / 1024)))} KB` : `${f.format(n / 1024 / 1024)} MB`;
}
