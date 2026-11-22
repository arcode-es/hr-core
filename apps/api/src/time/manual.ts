import type { ManualWorkdayInput } from '@hr/shared';

export interface PlannedSegment {
  entryType: 'WORK' | 'BREAK' | 'TRAVEL';
  breakKind: 'MEAL' | 'REST' | null;
  startTime: Date;
  endTime: Date;
}

export class InvalidRangeError extends Error {}

const MAX_WORKDAY_MS = 24 * 3600_000;

/**
 * Convierte una jornada declarada (inicio, fin y pausas) en tramos encadenados
 * sin huecos: trabajo entre pausas, y cada pausa como tramo propio.
 */
export function planSegments(input: Pick<ManualWorkdayInput, 'start' | 'end' | 'breaks'>, now: Date): PlannedSegment[] {
  const start = new Date(input.start);
  const end = new Date(input.end);
  if (!(end > start) || end.getTime() - start.getTime() > MAX_WORKDAY_MS) throw new InvalidRangeError('range');
  // No se puede declarar tiempo que aún no ha ocurrido.
  if (end > now) throw new InvalidRangeError('future');

  const breaks = input.breaks
    .map((b) => ({ kind: b.kind, start: new Date(b.start), end: new Date(b.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const segments: PlannedSegment[] = [];
  let cursor = start;
  for (const b of breaks) {
    if (!(b.end > b.start) || b.start < cursor || b.end > end) throw new InvalidRangeError('break');
    if (b.start > cursor) segments.push({ entryType: 'WORK', breakKind: null, startTime: cursor, endTime: b.start });
    segments.push(
      b.kind === 'TRAVEL'
        ? { entryType: 'TRAVEL', breakKind: null, startTime: b.start, endTime: b.end }
        : { entryType: 'BREAK', breakKind: b.kind, startTime: b.start, endTime: b.end },
    );
    cursor = b.end;
  }
  if (end > cursor) segments.push({ entryType: 'WORK', breakKind: null, startTime: cursor, endTime: end });
  return segments;
}
