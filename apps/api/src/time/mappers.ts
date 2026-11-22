import type { TimeSegmentDto, WorkdayDto } from '@hr/shared';
import type { Prisma, TimeEntry } from '@prisma/client';
import { totals } from './durations';

export type EntryWithLocation = TimeEntry & { location: { name: string; color: string | null } | null };

export const withLocation = { location: { select: { name: true, color: true } } } satisfies Prisma.TimeEntryInclude;

export const toSegment = (e: EntryWithLocation): TimeSegmentDto => ({
  id: e.id,
  entryType: e.entryType,
  breakKind: e.breakKind,
  startTime: e.startTime.toISOString(),
  endTime: e.endTime?.toISOString() ?? null,
  origin: e.origin,
  locationName: e.location?.name ?? null,
  locationColor: e.location?.color ?? null,
  isWithinGeofence: e.isWithinGeofence,
  geofenceDistanceMeters: e.geofenceDistanceMeters,
  hasPosition: e.startLat !== null,
  startAccuracy: e.startAccuracy,
  startAddress: e.startAddress,
  hasStartPhoto: e.startPhotoKey !== null,
  hasEndPhoto: e.endPhotoKey !== null,
  syncedOffline: e.syncedOffline,
  presenceMethod: e.presenceMethod,
  photoMissing: e.photoMissing,
});

/** Agrupa los tramos de una jornada (ordenados por inicio) en su resumen. */
export function toWorkday(entries: EntryWithLocation[], now: Date): WorkdayDto {
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  return {
    id: first.workdayId,
    startedAt: first.startTime.toISOString(),
    endedAt: last.endTime?.toISOString() ?? null,
    segments: entries.map(toSegment),
    ...totals(entries, now),
    manual: entries.some((e) => e.origin === 'MANUAL'),
    // Los tramos de una jornada comparten estado: se crean y se validan juntos.
    approvalStatus: first.approvalStatus,
    rejectionReason: first.rejectionReason,
    replacesWorkdayId: first.replacesWorkdayId,
    locationId: first.locationId,
    lateMinutes: first.lateMinutes,
  };
}

/** Agrupa tramos ordenados por inicio en jornadas, conservando el orden de aparición. */
export function groupWorkdays(entries: EntryWithLocation[], now: Date): WorkdayDto[] {
  const groups = new Map<string, EntryWithLocation[]>();
  for (const e of entries) {
    const g = groups.get(e.workdayId);
    if (g) g.push(e);
    else groups.set(e.workdayId, [e]);
  }
  return [...groups.values()].map((g) => toWorkday(g, now));
}
