import type { NotificationPayload, NotificationTypeId } from '@hr/shared';

type Texts = Record<NotificationTypeId, (p: NotificationPayload) => string>;

/**
 * Texto de una alerta de jornada. Con `name` va dirigida a quien supervisa; sin él,
 * a la propia persona (la misma alerta llega a ambos con textos distintos).
 */
export function alertText(p: NotificationPayload, locale: 'es' | 'en'): string {
  const who = p.name;
  const h = p.hours ?? 0;
  if (locale === 'en') {
    switch (p.alertKind) {
      case 'MISSED_CLOCK_IN':
        return who ? `${who} has not clocked in for their shift.` : 'You have not clocked in for your shift.';
      case 'LONG_WORKDAY':
        return who ? `${who} has had their workday open for over ${h} h.` : `Your workday has been open for over ${h} h. Did you forget to clock out?`;
      case 'SHORT_REST':
        return `${who} rested less than 12 h between workdays.`;
      case 'LONG_ORDINARY_DAY':
        return `${who} worked more than 9 h in a day.`;
      case 'OVERTIME_YEAR_70':
        return `${who} has used 70% of this year's overtime.`;
      case 'OVERTIME_YEAR_100':
        return `${who} has reached this year's overtime limit.`;
      default:
        return 'Working time alert.';
    }
  }
  switch (p.alertKind) {
    case 'MISSED_CLOCK_IN':
      return who ? `${who} no ha fichado la entrada de su turno.` : 'No has fichado la entrada de tu turno.';
    case 'LONG_WORKDAY':
      return who ? `${who} lleva más de ${h} h con la jornada abierta.` : `Llevas más de ${h} h con la jornada abierta. ¿Olvidaste fichar la salida?`;
    case 'SHORT_REST':
      return `${who} ha descansado menos de 12 h entre jornadas.`;
    case 'LONG_ORDINARY_DAY':
      return `${who} ha trabajado más de 9 h en un día.`;
    case 'OVERTIME_YEAR_70':
      return `${who} lleva el 70 % de las horas extra del año.`;
    case 'OVERTIME_YEAR_100':
      return `${who} ha llegado al tope de horas extra del año.`;
    default:
      return 'Alerta de jornada.';
  }
}

/** « del 3 al 7 de marzo» a partir de las fechas del aviso (AAAA-MM-DD). */
function range(p: NotificationPayload, locale: 'es' | 'en'): string {
  if (!p.from || !p.to) return '';
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const a = fmt.format(new Date(`${p.from}T00:00:00Z`));
  const b = fmt.format(new Date(`${p.to}T00:00:00Z`));
  if (p.from === p.to) return locale === 'en' ? ` on ${a}` : ` el ${a}`;
  return locale === 'en' ? ` from ${a} to ${b}` : ` del ${a} al ${b}`;
}

/** «12 nov» a partir de la fecha límite (AAAA-MM-DD). */
function due(p: NotificationPayload, locale: 'es' | 'en'): string {
  if (!p.dueDate) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${p.dueDate}T00:00:00Z`));
}

/** Texto de las notificaciones push, en el idioma de quien las recibe. (En la app las compone la web.) */
const ES: Texts = {
  SHIFT_PUBLISHED: (p) => (p.count === 1 ? 'Tienes un turno nuevo publicado.' : `Tienes ${p.count} turnos nuevos publicados.`),
  SHIFT_UPDATED: () => 'Ha cambiado tu horario.',
  TIME_ENTRY_PENDING: (p) => `${p.name} ha enviado una jornada para validar.`,
  TIME_ENTRY_REVIEWED: (p) => (p.approved ? 'Tu jornada ha sido aprobada.' : 'Tu jornada ha sido rechazada.'),
  EXPENSE_PENDING: (p) => `${p.name} ha enviado un gasto de ${p.amount}.`,
  EXPENSE_REVIEWED: (p) => (p.approved ? `Tu gasto de ${p.amount} ha sido aprobado.` : `Tu gasto de ${p.amount} ha sido rechazado.`),
  DOCUMENT_RECEIVED: (p) => (p.requiresSignature ? `Documento pendiente de firma: ${p.title}` : `Nuevo documento: ${p.title}`),
  DOCUMENT_SIGNED: (p) => `${p.name} ha firmado «${p.title}».`,
  INVITATION: (p) => `Te han invitado a ${p.title}.`,
  ABSENCE_PENDING: (p) => `${p.name} ha pedido una ausencia${range(p, 'es')}.`,
  ABSENCE_REVIEWED: (p) => (p.approved ? `Tu ausencia${range(p, 'es')} ha sido aprobada.` : `Tu ausencia${range(p, 'es')} ha sido rechazada.`),
  ALERT: (p) => alertText(p, 'es'),
  DOCUMENT_REMINDER: (p) => (p.overdue ? `Ha vencido el plazo de «${p.title}».` : `Recuerda: «${p.title}» vence el ${due(p, 'es')}.`),
};

const EN: Texts = {
  SHIFT_PUBLISHED: (p) => (p.count === 1 ? 'You have a new published shift.' : `You have ${p.count} new published shifts.`),
  SHIFT_UPDATED: () => 'Your schedule has changed.',
  TIME_ENTRY_PENDING: (p) => `${p.name} sent a workday for approval.`,
  TIME_ENTRY_REVIEWED: (p) => (p.approved ? 'Your workday was approved.' : 'Your workday was rejected.'),
  EXPENSE_PENDING: (p) => `${p.name} submitted an expense of ${p.amount}.`,
  EXPENSE_REVIEWED: (p) => (p.approved ? `Your ${p.amount} expense was approved.` : `Your ${p.amount} expense was rejected.`),
  DOCUMENT_RECEIVED: (p) => (p.requiresSignature ? `Document awaiting your signature: ${p.title}` : `New document: ${p.title}`),
  DOCUMENT_SIGNED: (p) => `${p.name} signed “${p.title}”.`,
  INVITATION: (p) => `You have been invited to ${p.title}.`,
  ABSENCE_PENDING: (p) => `${p.name} requested time off${range(p, 'en')}.`,
  ABSENCE_REVIEWED: (p) => (p.approved ? `Your time off${range(p, 'en')} was approved.` : `Your time off${range(p, 'en')} was rejected.`),
  ALERT: (p) => alertText(p, 'en'),
  DOCUMENT_REMINDER: (p) => (p.overdue ? `“${p.title}” is overdue.` : `Reminder: “${p.title}” is due on ${due(p, 'en')}.`),
};

export const pushText = (locale: string, type: NotificationTypeId, payload: NotificationPayload): string => (locale === 'en' ? EN : ES)[type](payload);

/** Resumen de los avisos retenidos durante el horario de desconexión. */
export const heldSummaryText = (locale: string, count: number): string =>
  locale === 'en' ? `You have ${count} new notifications.` : `Tienes ${count} avisos nuevos.`;
