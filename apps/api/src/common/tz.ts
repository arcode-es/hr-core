/**
 * Aritmética de fechas en una zona horaria IANA sin dependencias.
 * Los turnos y las horas nocturnas se definen en hora local de la empresa
 * («de 22:00 a 06:00»), que no es un desfase fijo: cambia dos veces al año.
 */

export interface WallTime {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Hora de pared de un instante en la zona indicada. */
export function wallTime(at: Date, tz: string): WallTime {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(at)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour!, minute: p.minute! };
}

const asUtc = (w: WallTime): number => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);

/**
 * Instante que corresponde a una hora de pared. Admite días fuera de rango
 * (día 32, día 0…), lo que permite sumar días sin más. Una hora inexistente
 * (el salto de primavera) se resuelve a la hora válida siguiente.
 */
export function fromWallTime(w: WallTime, tz: string): Date {
  const target = asUtc(w);
  let t = target;
  for (let i = 0; i < 3; i++) t -= asUtc(wallTime(new Date(t), tz)) - target;
  return new Date(t);
}

/** Día local YYYY-MM-DD de un instante. */
export function localDate(at: Date, tz: string): string {
  const w = wallTime(at, tz);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Mismo reloj, `days` días después: un turno de 08:00 sigue siendo de 08:00 aunque cambie la hora. */
export function addDaysKeepingWallTime(at: Date, days: number, tz: string): Date {
  const w = wallTime(at, tz);
  return fromWallTime({ ...w, day: w.day + days }, tz);
}

/** "22:00" → { hour: 22, minute: 0 }. */
export function parseClock(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
}
