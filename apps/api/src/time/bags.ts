import type { DayHours, HoursBag } from '@hr/shared';
import { fromWallTime, localDate, parseClock, wallTime } from '../common/tz';

export interface BagEntry {
  workdayId: string;
  entryType: 'WORK' | 'BREAK' | 'TRAVEL';
  startTime: Date;
  endTime: Date | null;
}

export interface BagShift {
  date: string;
  plannedStart: Date;
  plannedEnd: Date;
  breakMinutes: number;
  locationId?: string | null;
}

/** Por qué un día no se trabaja: festivo (en esa ubicación) o ausencia aprobada. */
export type OffDay = (date: string, locationId: string | null) => 'holiday' | 'absence' | null;

export interface BagConfig {
  timezone: string;
  /** Tramo nocturno en hora local, "HH:mm". */
  nightStart: string;
  nightEnd: string;
}

const empty = (): HoursBag => ({
  plannedSeconds: 0,
  workedSeconds: 0,
  ordinarySeconds: 0,
  overtimeSeconds: 0,
  nightSeconds: 0,
  travelSeconds: 0,
  breakSeconds: 0,
  absenceSeconds: 0,
});

const seconds = (from: number, to: number): number => Math.max(0, Math.floor((to - from) / 1000));

/** Segundos de [start, end) que caen dentro del tramo nocturno local. */
export function nightSeconds(start: Date, end: Date, cfg: BagConfig): number {
  const ns = parseClock(cfg.nightStart);
  const ne = parseClock(cfg.nightEnd);
  const crossesMidnight = ne.hour * 60 + ne.minute <= ns.hour * 60 + ns.minute;
  const first = wallTime(start, cfg.timezone);
  let total = 0;
  // Desde la víspera: la noche que empezó ayer puede seguir abierta esta madrugada.
  for (let offset = -1; ; offset++) {
    const day = { year: first.year, month: first.month, day: first.day + offset };
    const from = fromWallTime({ ...day, ...ns }, cfg.timezone).getTime();
    if (from >= end.getTime()) break;
    const to = fromWallTime({ ...day, day: day.day + (crossesMidnight ? 1 : 0), ...ne }, cfg.timezone).getTime();
    total += seconds(Math.max(from, start.getTime()), Math.min(to, end.getTime()));
  }
  return total;
}

/**
 * Bolsas de horas de una persona en un periodo.
 *
 * Cada jornada se imputa al día local en que empieza (un turno de noche cuenta
 * entero en su día de inicio). Dentro de cada día, lo trabajado hasta lo
 * planificado es ordinario y el resto extraordinario. Si la persona no tiene
 * ningún turno en el periodo no hay con qué comparar: todo es ordinario.
 */
export function computeBags(
  entries: BagEntry[],
  shifts: BagShift[],
  cfg: BagConfig,
  now: Date,
  off: OffDay = () => null,
): { hasPlan: boolean; total: HoursBag; days: DayHours[] } {
  const days = new Map<string, HoursBag>();
  const day = (date: string): HoursBag => {
    let d = days.get(date);
    if (!d) days.set(date, (d = empty()));
    return d;
  };

  // Un turno en festivo o en un día de ausencia aprobada no es tiempo previsto: en ausencia
  // son horas justificadas; en festivo, lo que se trabaje cuenta como extraordinario.
  for (const s of shifts) {
    const net = Math.max(0, seconds(s.plannedStart.getTime(), s.plannedEnd.getTime()) - s.breakMinutes * 60);
    const why = off(s.date, s.locationId ?? null);
    if (why === 'absence') day(s.date).absenceSeconds += net;
    else if (why !== 'holiday') day(s.date).plannedSeconds += net;
  }

  const workdayStart = new Map<string, Date>();
  for (const e of entries) {
    const known = workdayStart.get(e.workdayId);
    if (!known || e.startTime < known) workdayStart.set(e.workdayId, e.startTime);
  }

  for (const e of entries) {
    const end = e.endTime ?? now;
    const d = day(localDate(workdayStart.get(e.workdayId)!, cfg.timezone));
    const span = seconds(e.startTime.getTime(), end.getTime());
    if (e.entryType === 'WORK') {
      d.workedSeconds += span;
      d.nightSeconds += nightSeconds(e.startTime, end, cfg);
    } else if (e.entryType === 'TRAVEL') d.travelSeconds += span;
    else d.breakSeconds += span;
  }

  const hasPlan = shifts.length > 0;
  const total = empty();
  const list: DayHours[] = [];
  for (const [date, d] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    d.ordinarySeconds = hasPlan ? Math.min(d.workedSeconds, d.plannedSeconds) : d.workedSeconds;
    d.overtimeSeconds = d.workedSeconds - d.ordinarySeconds;
    for (const k of Object.keys(total) as (keyof HoursBag)[]) total[k] += d[k];
    list.push({ date, ...d });
  }
  return { hasPlan, total, days: list };
}
