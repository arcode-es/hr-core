import type { ClockInput, ClockStatus, GeofenceMatch, TimeSegmentDto, WorkdayDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, isNetworkError } from './api';
import { enqueue, flushOutbox, pendingClockEvents } from './outbox';
import { currentPosition, type DevicePosition } from './geolocation';
import { queryClient } from './query';
import { useSession } from '../stores/session';

/** Estado del fichaje más el desfase entre el reloj del dispositivo y el del servidor. */
export interface ClockView extends ClockStatus {
  offsetMs: number;
}

const withOffset = (s: ClockStatus): ClockView => ({ ...s, offsetMs: Date.parse(s.serverTime) - Date.now() });

export const clockKey = (workspaceId: string) => ['clock', workspaceId] as const;
export const workdaysKey = (workspaceId: string) => ['workdays', workspaceId] as const;

// ── Copia local del estado, para seguir fichando sin conexión ────────────

const snapshotKey = (userId: string, workspaceId: string): string => `hr.clock.${userId}.${workspaceId}`;

function saveSnapshot(userId: string, workspaceId: string, view: ClockView): void {
  try {
    localStorage.setItem(snapshotKey(userId, workspaceId), JSON.stringify(view));
  } catch {
    /* sin almacenamiento: no habrá estado al reabrir sin red */
  }
}

function loadSnapshot(userId: string, workspaceId: string): ClockView | null {
  try {
    return JSON.parse(localStorage.getItem(snapshotKey(userId, workspaceId)) ?? 'null') as ClockView | null;
  } catch {
    return null;
  }
}

/** Los tramos creados en el móvil y aún no enviados llevan este prefijo en su id. */
export const isLocalSegment = (s: TimeSegmentDto): boolean => s.id.startsWith('local-');

/**
 * Aplica un evento de fichaje al estado local con las mismas reglas que el
 * servidor. Se usa sin conexión: la pantalla responde al instante y el evento
 * real viaja después desde la cola.
 */
export function applyLocally(
  view: ClockView,
  action: ClockInput['action'],
  pause: ClockInput['pause'],
  at: string,
  hasPosition: boolean,
  hasPhoto: boolean,
  extra: { qr?: boolean; photoMissing?: boolean } = {},
): ClockView {
  const day = view.workday;
  const open = day?.segments[day.segments.length - 1];
  const valid =
    (action === 'START' && view.state === 'IDLE') ||
    (action === 'PAUSE' && view.state === 'WORKING') ||
    (action === 'RESUME' && view.state === 'PAUSED') ||
    (action === 'STOP' && view.state !== 'IDLE');
  if (!valid) throw new ApiError(409, 'INVALID_CLOCK_STATE');

  if (action === 'STOP') return { ...view, state: 'IDLE', workday: null };

  const entryType = action === 'PAUSE' ? (pause === 'TRAVEL' ? 'TRAVEL' : 'BREAK') : 'WORK';
  const segment: TimeSegmentDto = {
    id: `local-${crypto.randomUUID()}`,
    entryType,
    breakKind: entryType === 'BREAK' ? (pause === 'MEAL' ? 'MEAL' : 'REST') : null,
    startTime: at,
    endTime: null,
    origin: 'REALTIME',
    locationName: null,
    locationColor: null,
    isWithinGeofence: null,
    geofenceDistanceMeters: null,
    hasPosition,
    startAccuracy: null,
    startAddress: null,
    hasStartPhoto: hasPhoto,
    hasEndPhoto: false,
    syncedOffline: true,
    presenceMethod: extra.qr ? 'QR' : hasPosition ? 'GPS' : 'NONE',
    photoMissing: !!extra.photoMissing,
  };
  const closed = day && open ? [...day.segments.slice(0, -1), { ...open, endTime: at }] : [];
  const workday: WorkdayDto = day
    ? { ...day, segments: [...closed, segment] }
    : {
        id: `local-${crypto.randomUUID()}`,
        startedAt: at,
        endedAt: null,
        segments: [segment],
        workedSeconds: 0,
        breakSeconds: 0,
        travelSeconds: 0,
        manual: false,
        approvalStatus: 'APPROVED',
        rejectionReason: null,
        replacesWorkdayId: null,
        locationId: null,
        lateMinutes: null,
      };
  return { ...view, state: entryType === 'WORK' ? 'WORKING' : 'PAUSED', workday };
}

export function useClockStatus() {
  const workspaceId = useSession((s) => s.workspaceId);
  const userId = useSession((s) => s.user?.id ?? '');
  return useQuery({
    queryKey: clockKey(workspaceId),
    queryFn: async () => {
      try {
        // Primero se envía lo pendiente: así el servidor ya refleja lo fichado sin conexión.
        await flushOutbox();
        if ((await pendingClockEvents(workspaceId)) > 0) throw new ApiError(0, 'NETWORK');
        const view = withOffset(await api<ClockStatus>('/time/status'));
        saveSnapshot(userId, workspaceId, view);
        return view;
      } catch (e) {
        // Sin red (o con fichajes aún por enviar) manda la copia local.
        const snapshot = isNetworkError(e) ? loadSnapshot(userId, workspaceId) : null;
        if (snapshot) return snapshot;
        if (isNetworkError(e)) return { serverTime: new Date().toISOString(), state: 'IDLE', workday: null, shift: null, requirePhoto: false, notes: [], offsetMs: 0 } satisfies ClockView;
        throw e;
      }
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    networkMode: 'always',
  });
}

export function useWorkdays(days = 14) {
  const workspaceId = useSession((s) => s.workspaceId);
  return useQuery({ queryKey: workdaysKey(workspaceId), queryFn: () => api<WorkdayDto[]>(`/time/workdays?days=${days}`) });
}

/** Hora del servidor que avanza cada segundo: el cronómetro no depende del reloj del móvil. */
export function useServerNow(offsetMs: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    setNow(Date.now() + offsetMs);
    if (!running) return;
    const id = setInterval(() => setNow(Date.now() + offsetMs), 1000);
    return () => clearInterval(id);
  }, [offsetMs, running]);
  return now;
}

/** Totales de la jornada recalculados en el cliente para que el cronómetro avance. */
export function liveTotals(day: WorkdayDto, nowMs: number): { worked: number; breaks: number; travel: number; current: number } {
  let worked = 0;
  let breaks = 0;
  let travel = 0;
  let current = 0;
  for (const s of day.segments) {
    const seconds = Math.max(0, Math.floor(((s.endTime ? Date.parse(s.endTime) : nowMs) - Date.parse(s.startTime)) / 1000));
    if (s.entryType === 'WORK') worked += seconds;
    else if (s.entryType === 'BREAK') breaks += seconds;
    else travel += seconds;
    if (!s.endTime) current = seconds;
  }
  return { worked, breaks, travel, current };
}

export type PositionState =
  | { status: 'pending' }
  | { status: 'ok'; position: DevicePosition; at: number }
  | { status: 'denied' | 'unavailable' };

/** Sigue la posición mientras la pantalla está abierta, para tenerla lista al fichar. */
export function useLivePosition(): PositionState {
  const [state, setState] = useState<PositionState>({ status: 'pending' });
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState({ status: 'unavailable' });
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setState({
          status: 'ok',
          position: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy },
          at: Date.now(),
        }),
      (e) => setState((prev) => (prev.status === 'ok' ? prev : { status: e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable' })),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return state;
}

/** Ubicación más cercana a la posición actual, redondeada (~11 m) para no consultar en cada lectura del GPS. */
export function useNearest(state: PositionState) {
  const workspaceId = useSession((s) => s.workspaceId);
  const pos = state.status === 'ok' ? state.position : null;
  const lat = pos?.lat.toFixed(4);
  const lng = pos?.lng.toFixed(4);
  const accuracy = pos ? Math.round(pos.accuracy / 10) * 10 : 0;
  return useQuery({
    queryKey: ['near', workspaceId, lat, lng, accuracy],
    // La misma regla que aplica el servidor al fichar: la ubicación del turno asignado o, si no hay, la más cercana.
    queryFn: async () => {
      const { match } = await api<{ match: GeofenceMatch | null }>(`/time/geofence?lat=${pos!.lat}&lng=${pos!.lng}&accuracy=${pos!.accuracy}`);
      return match ? [match] : [];
    },
    enabled: !!pos,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

interface ClockRequest {
  action: ClockInput['action'];
  pause?: ClockInput['pause'];
  photo?: Blob | null;
  /** QR de la ubicación leído en el cartel: cuenta como presencia aunque no haya GPS. */
  qr?: ClockInput['qr'];
  /** La empresa pide foto y no se ha podido hacer. */
  photoUnavailable?: boolean;
  /** Nota de relevo, solo al terminar la jornada. */
  note?: ClockInput['note'];
}

/** Envía un evento de fichaje con la mejor posición disponible; sin posición, ficha igualmente. */
export function useClock(position: PositionState) {
  const workspaceId = useSession((s) => s.workspaceId);
  const userId = useSession((s) => s.user?.id ?? '');
  const latest = useRef(position);
  latest.current = position;

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ action, pause, photo, qr, photoUnavailable, note }: ClockRequest): Promise<ClockView & { queued?: boolean }> => {
      let pos: DevicePosition | null = null;
      const p = latest.current;
      if (p.status === 'ok' && Date.now() - p.at < 60_000) pos = p.position;
      else if (p.status !== 'denied') pos = await currentPosition(6000).catch(() => null);

      const current = queryClient.getQueryData<ClockView>(clockKey(workspaceId));
      const data: ClockInput = {
        action,
        pause,
        position: pos ? { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy } : null,
        clientTime: new Date().toISOString(),
        clientUuid: crypto.randomUUID(),
        ...(qr ? { qr } : {}),
        ...(photoUnavailable && !photo ? { photoUnavailable: true } : {}),
        ...(note && action === 'STOP' ? { note } : {}),
      };
      const send = async (): Promise<ClockView> => {
        const form = new FormData();
        form.append('data', JSON.stringify(data));
        if (photo) form.append('photo', photo, 'evidencia.jpg');
        return withOffset(await api<ClockStatus>('/time/clock', { method: 'POST', body: form }));
      };

      // Con fichajes aún en cola no se envía este por delante: se rompería el orden.
      const mustQueue = !navigator.onLine || (await pendingClockEvents(workspaceId)) > 0;
      if (!mustQueue) {
        try {
          const view = await send();
          saveSnapshot(userId, workspaceId, view);
          return view;
        } catch (e) {
          if (!isNetworkError(e)) throw e;
        }
      }

      // Sin conexión: se valida y se aplica en local, y el evento espera en la cola
      // con la hora en que ocurrió (corregida con el último desfase conocido del servidor).
      if (!current) throw new ApiError(0, 'NETWORK');
      const occurredAt = new Date(Date.now() + current.offsetMs).toISOString();
      const view = applyLocally(current, action, pause, occurredAt, !!pos, !!photo, { qr: !!qr, photoMissing: !!data.photoUnavailable });
      await enqueue({ kind: 'clock', workspaceId, data: JSON.stringify({ ...data, occurredAt }), file: photo ?? undefined });
      saveSnapshot(userId, workspaceId, view);
      return { ...view, queued: true };
    },
    onSuccess: (status) => {
      queryClient.setQueryData(clockKey(workspaceId), status);
      void queryClient.invalidateQueries({ queryKey: workdaysKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: ['handover-sent', workspaceId] });
      navigator.vibrate?.(35);
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: clockKey(workspaceId) }),
  });
}
