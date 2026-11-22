/** Utilidades de calendario en la hora local del navegador. La semana empieza en lunes. */

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, days: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
export const startOfWeek = (d: Date): Date => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
export const startOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d: Date, months: number): Date => new Date(d.getFullYear(), d.getMonth() + months, 1);
export const sameDay = (a: Date, b: Date): boolean => startOfDay(a).getTime() === startOfDay(b).getTime();

const pad = (n: number): string => String(n).padStart(2, '0');
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const clockTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Fecha «YYYY-MM-DD» y hora «HH:mm» locales → instante. */
export const atTime = (date: string, time: string): Date => new Date(`${date}T${time}:00`);

/** «2 – 8 mar 2026», o «30 mar – 5 abr 2026» si la semana cruza de mes. */
export function weekLabel(monday: Date, locale: string | undefined): string {
  const sunday = addDays(monday, 6);
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric' });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const full = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${monday.getMonth() === sunday.getMonth() ? day.format(monday) : dayMonth.format(monday)} – ${full.format(sunday)}`;
}

/** Horas con un decimal como mucho: 27000 s → "7,5 h". */
export function formatHours(seconds: number, locale: string | undefined): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(seconds / 3600)} h`;
}
