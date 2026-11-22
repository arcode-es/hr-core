export interface Span {
  entryType: 'WORK' | 'BREAK' | 'TRAVEL';
  startTime: Date;
  endTime: Date | null;
}

export interface Totals {
  workedSeconds: number;
  breakSeconds: number;
  travelSeconds: number;
}

/** Suma el tiempo por tipo de tramo. Los tramos abiertos cuentan hasta `now`. */
export function totals(spans: Span[], now: Date): Totals {
  const t: Totals = { workedSeconds: 0, breakSeconds: 0, travelSeconds: 0 };
  for (const s of spans) {
    const seconds = Math.max(0, Math.floor(((s.endTime ?? now).getTime() - s.startTime.getTime()) / 1000));
    if (s.entryType === 'WORK') t.workedSeconds += seconds;
    else if (s.entryType === 'BREAK') t.breakSeconds += seconds;
    else t.travelSeconds += seconds;
  }
  return t;
}
