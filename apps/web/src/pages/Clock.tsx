import type { ClockInput, LocationDto, PauseKind, ShiftDto, WorkdayDto } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase,
  CalendarDays,
  Camera,
  Car,
  CircleCheck,
  Coffee,
  Image as ImageIcon,
  type LucideIcon,
  MapPin,
  MapPinOff,
  History as HistoryIcon,
  Pause,
  PencilLine,
  Play,
  Plus,
  QrCode,
  ScanLine,
  Square,
  TriangleAlert,
  Utensils,
  X,
} from 'lucide-react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { GeoNoticeGate } from '../app/GeoNotice';
import { api } from '../lib/api';
import {
  type ClockView,
  liveTotals,
  type PositionState,
  useClock,
  useClockStatus,
  useLivePosition,
  useNearest,
  useServerNow,
  useWorkdays,
} from '../lib/clock';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { formatDay, formatDistance, formatDuration, formatTime, formatTimer } from '../lib/format';
import { evidenceLines, stampPhoto } from '../lib/photo';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { AuditSheet } from '../time/AuditSheet';
import { EMPTY_HANDOVER, HandoverComposer, HandoverNotes, SentHandoverNotes } from '../time/Handover';
import { WorkdayFormSheet } from '../time/WorkdayForm';
import { PhotoSheet, SEGMENT_ICON, segmentKind, Timeline } from '../time/Timeline';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';
import { PageHeader } from '../ui/Page';
import { QrScanner } from '../ui/QrScanner';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';

// ── Dónde estoy ──────────────────────────────────────────────────────────

/** Antes de fichar ya se ve qué va a quedar registrado: ubicación detectada o aviso. */
function LocationChip({ position }: { position: PositionState }) {
  const { t, i18n } = useTranslation();
  const near = useNearest(position);
  const nearest = near.data?.[0];

  let tone: 'neutral' | 'success' | 'warning' = 'neutral';
  let Icon: LucideIcon = MapPin;
  let title: string;
  let detail: string | undefined;

  if (position.status === 'pending') {
    title = t('clock.locating');
  } else if (position.status !== 'ok') {
    tone = 'warning';
    Icon = MapPinOff;
    title = t(position.status === 'denied' ? 'clock.gpsDenied' : 'clock.gpsUnavailable');
    detail = t('clock.gpsStillAllowed');
  } else {
    const accuracy = `±${formatDistance(position.position.accuracy, i18n.resolvedLanguage)}`;
    if (!nearest) {
      // Sin conexión no se puede consultar el perímetro, pero la posición GPS ya está lista.
      const checking = near.isPending && near.fetchStatus !== 'paused';
      title = checking ? t('clock.locating') : t('clock.positionReady');
      detail = checking ? undefined : t('clock.accuracy', { accuracy });
    } else if (nearest.within) {
      tone = 'success';
      Icon = CircleCheck;
      title = t('clock.atLocation', { name: nearest.location.name });
      detail = t('clock.accuracy', { accuracy });
    } else {
      tone = 'warning';
      Icon = TriangleAlert;
      title = t('clock.outside');
      detail = t('clock.outsideBy', {
        distance: formatDistance(nearest.outsideByMeters, i18n.resolvedLanguage),
        name: nearest.location.name,
      });
    }
  }

  const tones = {
    neutral: 'bg-surface text-fg',
    success: 'bg-success-soft text-success-text',
    warning: 'bg-warning-soft text-warning-text',
  };

  return (
    <div role="status" className={cn('edge flex items-center gap-3 rounded-2xl px-4 py-3', tones[tone])}>
      {position.status === 'pending' ? <Spinner className="size-5 shrink-0" /> : <Icon className="size-5 shrink-0" />}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        {detail && <p className="truncate text-sm">{detail}</p>}
      </div>
    </div>
  );
}

// ── Foto de evidencia ────────────────────────────────────────────────────

/** Abre la cámara del móvil y devuelve la foto ya reducida y con la franja de evidencia. */
function usePhotoInput(position: PositionState, offsetMs: number, onPhoto: (b: Blob) => void) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const pos = position.status === 'ok' ? position.position : null;
      onPhoto(await stampPhoto(file, evidenceLines(new Date(Date.now() + offsetMs), pos, t('clock.stampNoPosition'))));
    } catch {
      toast.error(t('clock.photoError'));
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    open: () => input.current?.click(),
    // capture="environment" abre directamente la cámara trasera en el móvil.
    element: <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} tabIndex={-1} aria-hidden="true" />,
  };
}

function PhotoPicker({
  photo,
  onChange,
  position,
  offsetMs,
  required,
}: {
  photo: Blob | null;
  onChange: (b: Blob | null) => void;
  position: PositionState;
  offsetMs: number;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const camera = usePhotoInput(position, offsetMs, onChange);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  return (
    <div>
      {camera.element}
      {preview ? (
        <div className="edge flex items-center gap-3 rounded-2xl bg-surface p-2">
          <img src={preview} alt={t('clock.photoAlt')} className="size-14 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('clock.photoReady')}</p>
            <p className="text-sm text-fg-muted">{t('clock.photoReadyHint')}</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t('clock.photoRemove')}
            className="focus-ring flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-5" />
          </button>
        </div>
      ) : (
        <>
          <Button variant="secondary" block loading={camera.busy} onClick={camera.open} icon={<Camera className="size-5" />}>
            {t('clock.addPhoto')}
          </Button>
          {required && <p className="mt-2 text-center text-sm text-fg-muted">{t('clock.photoRequiredHint')}</p>}
        </>
      )}
    </div>
  );
}

/** La empresa pide foto: se hace ahora o se ficha igualmente dejándolo indicado. */
function PhotoRequiredSheet({
  open,
  onClose,
  onPhoto,
  onSkip,
  position,
  offsetMs,
}: {
  open: boolean;
  onClose: () => void;
  onPhoto: (b: Blob) => void;
  onSkip: () => void;
  position: PositionState;
  offsetMs: number;
}) {
  const { t } = useTranslation();
  const camera = usePhotoInput(position, offsetMs, onPhoto);
  return (
    <Sheet open={open} onClose={onClose} title={t('clock.photoRequiredTitle')} description={t('clock.photoRequiredDesc')}>
      {camera.element}
      <div className="space-y-2.5 pt-1">
        <Button size="lg" block loading={camera.busy} onClick={camera.open} icon={<Camera className="size-5" />}>
          {t('clock.takePhoto')}
        </Button>
        <Button variant="ghost" block onClick={onSkip}>
          {t('clock.noPhoto')}
        </Button>
        <p className="text-center text-sm text-fg-muted">{t('clock.noPhotoHint')}</p>
      </div>
    </Sheet>
  );
}

// ── QR de la ubicación ───────────────────────────────────────────────────

type QrTarget = NonNullable<ClockInput['qr']>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QR_CODE = /^[A-Za-z0-9_-]{16,64}$/;

/** Lee el enlace del cartel (…/clock?l=<ubicación>&k=<código>). */
export function parseLocationQr(text: string): QrTarget | null {
  try {
    const url = new URL(text, window.location.origin);
    const locationId = url.searchParams.get('l') ?? '';
    const code = url.searchParams.get('k') ?? '';
    return url.pathname.endsWith('/clock') && UUID.test(locationId) && QR_CODE.test(code) ? { locationId, code } : null;
  } catch {
    return null;
  }
}

function QrChip({ qr, onRemove }: { qr: QrTarget; onRemove: () => void }) {
  const { t } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const { data } = useQuery({ queryKey: ['locations', workspaceId], queryFn: () => api<LocationDto[]>('/locations'), staleTime: 300_000 });
  const name = data?.find((l) => l.id === qr.locationId)?.name;
  return (
    <div role="status" className="edge flex items-center gap-3 rounded-2xl bg-success-soft px-4 py-3 text-success-text">
      <QrCode className="size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name ? t('clock.qrReady', { name }) : t('clock.qrReadyGeneric')}</p>
        <p className="truncate text-sm">{t('clock.qrReadyHint')}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('clock.qrRemove')}
        className="focus-ring -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-black/5"
      >
        <X className="size-5" />
      </button>
    </div>
  );
}

// ── Cronómetro y acciones ────────────────────────────────────────────────

/** Turno asignado de hoy: contra él se mide la geocerca y, después, las horas extra. */
function ShiftLine({ shift }: { shift: ShiftDto }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  return (
    <p className="mx-auto mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-sm font-medium text-fg-muted contrast:border-2 contrast:border-current">
      <CalendarDays className="size-4 shrink-0" />
      <span className="truncate">
        {t('clock.shift', { from: formatTime(shift.plannedStart, lang), to: formatTime(shift.plannedEnd, lang) })}
        {shift.locationName && ` · ${shift.locationName}`}
      </span>
    </p>
  );
}

function Hero({ view, position, qr, onQrUsed }: { view: ClockView; position: PositionState; qr: QrTarget | null; onQrUsed: () => void }) {
  const { t, i18n } = useTranslation();
  const clock = useClock(position);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [pausing, setPausing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [handover, setHandover] = useState(EMPTY_HANDOVER);
  const ws = useWorkspace();
  const [needsPhoto, setNeedsPhoto] = useState<'START' | 'STOP' | null>(null);
  const now = useServerNow(view.offsetMs, view.state !== 'IDLE');

  const day = view.workday;
  const live = day ? liveTotals(day, now) : null;
  const current = day?.segments[day.segments.length - 1];

  const send = (action: 'START' | 'PAUSE' | 'RESUME' | 'STOP', pause?: PauseKind, opts: { photo?: Blob; photoUnavailable?: boolean } = {}): void => {
    setPausing(false);
    setStopping(false);
    const evidence = opts.photo ?? photo;
    // Foto obligatoria al empezar y al terminar: antes de enviar, se pide (o se declara que no se puede).
    if (view.requirePhoto && (action === 'START' || action === 'STOP') && !evidence && !opts.photoUnavailable) {
      setNeedsPhoto(action);
      return;
    }
    setNeedsPhoto(null);
    const text = handover.text.trim();
    const note = action === 'STOP' && ws.kind === 'organization' && text ? { text, recipientId: handover.recipientId || null } : undefined;
    clock.mutate(
      { action, pause, photo: evidence, qr: qr ?? undefined, photoUnavailable: opts.photoUnavailable, note },
      {
        onSuccess: (view) => {
          setPhoto(null);
          if (action === 'STOP') {
            onQrUsed();
            setHandover(EMPTY_HANDOVER);
          }
          if (view.queued) toast.info(t('offline.clockSaved'));
          else toast.success(t(note ? 'handover.doneWithNote' : `clock.done_${action}`));
          if (action === 'START' && view.notes?.length) toast.info(t('handover.arrived', { count: view.notes.length }));
        },
        onError: (e) => toast.error(errorMessage(t, e)),
      },
    );
  };
  const photoSheet = (
    <PhotoRequiredSheet
      open={!!needsPhoto}
      onClose={() => setNeedsPhoto(null)}
      onPhoto={(b) => needsPhoto && send(needsPhoto, undefined, { photo: b })}
      onSkip={() => needsPhoto && send(needsPhoto, undefined, { photoUnavailable: true })}
      position={position}
      offsetMs={view.offsetMs}
    />
  );

  const today = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

  if (view.state === 'IDLE' || !day || !live || !current) {
    return (
      <Card className="flex flex-col items-center px-5 pt-7 pb-5 text-center">
        <p className="text-sm font-medium text-fg-muted first-letter:uppercase">{today}</p>
        <p className="mt-1 text-xl font-bold tracking-tight">{t('clock.idleTitle')}</p>
        {view.shift && <ShiftLine shift={view.shift} />}
        <button
          type="button"
          onClick={() => send('START')}
          disabled={clock.isPending}
          className="focus-ring group relative my-7 flex size-48 flex-col items-center justify-center gap-2 rounded-full bg-accent text-accent-fg shadow-[0_18px_40px_-12px_var(--accent)] transition-transform active:scale-95 disabled:opacity-70 contrast:shadow-none"
        >
          <span aria-hidden="true" className="absolute -inset-3 rounded-full border-2 border-accent/25 contrast:hidden" />
          <span aria-hidden="true" className="absolute -inset-6 rounded-full border border-accent/10 contrast:hidden" />
          {clock.isPending ? <Spinner className="size-11" /> : <Play className="size-11 fill-current" />}
          <span className="text-lg font-bold">{t('clock.start')}</span>
        </button>
        <div className="w-full">
          <PhotoPicker photo={photo} onChange={setPhoto} position={position} offsetMs={view.offsetMs} required={view.requirePhoto} />
        </div>
        {photoSheet}
      </Card>
    );
  }

  const paused = view.state === 'PAUSED';
  const kind = segmentKind(current);
  const KindIcon = SEGMENT_ICON[kind];

  return (
    <>
      <Card className="px-5 pt-6 pb-5 text-center">
        <span
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-sm font-semibold contrast:border-2 contrast:border-current',
            paused ? 'bg-warning-soft text-warning-text' : 'bg-success-soft text-success-text',
          )}
        >
          {paused ? (
            <KindIcon className="size-4" />
          ) : (
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-success" />
            </span>
          )}
          {paused ? t(`clock.kind_${kind}`) : t('clock.working')}
        </span>

        <p
          role="timer"
          aria-label={paused ? t('clock.pauseTime') : t('clock.workedTime')}
          className={cn('mt-4 text-[64px] leading-none font-bold tracking-tighter tabular-nums', paused && 'text-warning-text')}
        >
          {formatTimer(paused ? live.current : live.worked)}
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          {paused
            ? t('clock.workedSoFar', { time: formatDuration(live.worked) })
            : t('clock.since', { time: formatTime(day.startedAt, i18n.resolvedLanguage) })}
        </p>
        {view.shift && <ShiftLine shift={view.shift} />}
        {day.lateMinutes !== null && (
          <p className="mt-2">
            <Badge tone="warning">{t('clock.late', { count: day.lateMinutes })}</Badge>
          </p>
        )}

        <dl className="edge mx-auto mt-5 grid max-w-sm grid-cols-3 divide-x divide-border rounded-2xl bg-surface-2/60 py-3 text-center">
          {[
            [t('clock.worked'), live.worked],
            [t('clock.breaks'), live.breaks],
            [t('clock.travel'), live.travel],
          ].map(([label, seconds]) => (
            <div key={label as string} className="px-2">
              <dt className="text-xs font-medium text-fg-muted">{label}</dt>
              <dd className="mt-0.5 text-sm font-bold tabular-nums">{formatDuration(seconds as number)}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {paused ? (
            <Button size="lg" block loading={clock.isPending} onClick={() => send('RESUME')} icon={<Play className="size-5 fill-current" />}>
              {t('clock.resume')}
            </Button>
          ) : (
            <Button variant="secondary" size="lg" block disabled={clock.isPending} onClick={() => setPausing(true)} icon={<Pause className="size-5" />}>
              {t('clock.pause')}
            </Button>
          )}
          <Button
            variant={paused ? 'secondary' : 'danger'}
            size="lg"
            block
            disabled={clock.isPending}
            onClick={() => setStopping(true)}
            icon={<Square className="size-4 fill-current" />}
            className={cn(paused && 'text-danger-text')}
          >
            {t('clock.stop')}
          </Button>
        </div>
        <div className="mt-3">
          <PhotoPicker photo={photo} onChange={setPhoto} position={position} offsetMs={view.offsetMs} required={view.requirePhoto} />
        </div>
      </Card>
      {photoSheet}

      <Sheet open={pausing} onClose={() => setPausing(false)} title={t('clock.pauseTitle')} description={t('clock.pauseDesc')}>
        <div className="space-y-2 pt-1">
          {(['MEAL', 'REST', 'TRAVEL'] as const).map((p) => {
            const Icon = SEGMENT_ICON[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => send('PAUSE', p)}
                className="focus-ring edge flex w-full items-center gap-3.5 rounded-2xl p-3.5 text-left transition-colors hover:bg-surface-2 active:scale-[0.99]"
              >
                <span className="flex size-12 items-center justify-center rounded-xl bg-warning-soft text-warning-text">
                  <Icon className="size-6" />
                </span>
                <span>
                  <span className="block font-semibold">{t(`clock.kind_${p}`)}</span>
                  <span className="block text-sm text-fg-muted">{t(`clock.kind_${p}_desc`)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>

      <Sheet open={stopping} onClose={() => setStopping(false)} title={t('clock.stopTitle')} description={t('clock.stopDesc')}>
        <dl className="edge mb-4 grid grid-cols-3 divide-x divide-border rounded-2xl py-3.5 text-center">
          {[
            [t('clock.worked'), live.worked],
            [t('clock.breaks'), live.breaks],
            [t('clock.travel'), live.travel],
          ].map(([label, seconds]) => (
            <div key={label as string} className="px-2">
              <dt className="text-xs font-medium text-fg-muted">{label}</dt>
              <dd className="mt-0.5 font-bold tabular-nums">{formatDuration(seconds as number)}</dd>
            </div>
          ))}
        </dl>
        {ws.kind === 'organization' && <HandoverComposer value={handover} onChange={setHandover} />}
        <div className="space-y-2.5">
          <Button variant="danger" size="lg" block onClick={() => send('STOP')} icon={<Square className="size-4 fill-current" />}>
            {t('clock.stopConfirm')}
          </Button>
          <Button variant="ghost" block onClick={() => setStopping(false)}>
            {t('clock.keepWorking')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

// ── Historial ────────────────────────────────────────────────────────────

function History({ openId, now, onPhoto }: { openId: string | null; now: number; onPhoto: (id: string, which: 'start' | 'end') => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const { data } = useWorkdays();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<{ workday: WorkdayDto | null } | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const past = (data ?? []).filter((d) => d.id !== openId);

  return (
    <section aria-labelledby="history-title">
      <div className="mb-2.5 flex items-center justify-between">
        <SectionTitle id="history-title">{t('clock.history')}</SectionTitle>
        <Button variant="ghost" size="sm" onClick={() => setForm({ workday: null })} icon={<Plus className="size-4" />}>
          {t('manual.add')}
        </Button>
      </div>
      {past.length === 0 ? (
        <Card className="px-5 py-8 text-center text-sm text-fg-muted">{t('clock.historyEmpty')}</Card>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {past.map((d, i) => {
              const flagged = d.segments.some((s) => s.isWithinGeofence === false || s.photoMissing || (!s.hasPosition && s.origin === 'REALTIME' && s.presenceMethod === 'NONE'));
              const open = expanded === d.id;
              const rejected = d.approvalStatus === 'REJECTED';
              return (
                <li key={d.id} className={cn(i > 0 && 'edge-t')}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : d.id)}
                    className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn('block font-semibold first-letter:uppercase', rejected && 'text-fg-muted line-through')}>
                        {formatDay(d.startedAt, lang)}
                      </span>
                      <span className="block text-sm text-fg-muted tabular-nums">
                        {formatTime(d.startedAt, lang)} – {d.endedAt ? formatTime(d.endedAt, lang) : t('clock.ongoing')}
                      </span>
                      {(d.manual || d.approvalStatus !== 'APPROVED' || d.lateMinutes !== null) && (
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {d.lateMinutes !== null && <Badge tone="warning">{t('clock.late', { count: d.lateMinutes })}</Badge>}
                          {d.approvalStatus === 'PENDING' && (
                            <Badge tone="warning">{d.replacesWorkdayId ? t('manual.badgeCorrectionPending') : t('manual.badgePending')}</Badge>
                          )}
                          {rejected && <Badge tone="danger">{d.replacesWorkdayId ? t('manual.badgeCorrectionRejected') : t('manual.badgeRejected')}</Badge>}
                          {d.manual && d.approvalStatus === 'APPROVED' && <Badge>{t('manual.badgeManual')}</Badge>}
                        </span>
                      )}
                    </span>
                    {flagged && <TriangleAlert className="size-[18px] shrink-0 text-warning" aria-label={t('clock.flagged')} />}
                    <span className={cn('shrink-0 text-right', rejected && 'opacity-50')}>
                      <span className="block font-bold tabular-nums">{formatDuration(d.workedSeconds)}</span>
                      {d.breakSeconds + d.travelSeconds > 0 && (
                        <span className="block text-xs text-fg-muted tabular-nums">
                          +{formatDuration(d.breakSeconds + d.travelSeconds)} {t('clock.notWorked')}
                        </span>
                      )}
                    </span>
                  </button>
                  {open && (
                    <div className="edge-t bg-surface-2/40">
                      {rejected && d.rejectionReason && (
                        <p className="mx-4 mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger-text">
                          {t('manual.rejectedBecause', { reason: d.rejectionReason })}
                        </p>
                      )}
                      <Timeline day={d} now={now} onPhoto={onPhoto} />
                      <div className="edge-t flex gap-2 px-4 py-3">
                        {d.approvalStatus === 'APPROVED' && d.endedAt && (
                          <Button variant="secondary" size="sm" onClick={() => setForm({ workday: d })} icon={<PencilLine className="size-4" />}>
                            {t('manual.correct')}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setAudit(d.replacesWorkdayId ?? d.id)} icon={<HistoryIcon className="size-4" />}>
                          {t('audit.open')}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <WorkdayFormSheet open={!!form} onClose={() => setForm(null)} workday={form?.workday} />
      <AuditSheet workdayId={audit} onClose={() => setAudit(null)} />
    </section>
  );
}

export function Clock() {
  const { t } = useTranslation();
  return (
    <div className="animate-page space-y-4">
      <PageHeader title={t('nav.clock')} />
      {/* El GPS no se activa hasta que la persona ha recibido el aviso de geolocalización de su empresa. */}
      <GeoNoticeGate>
        <ClockScreen />
      </GeoNoticeGate>
    </div>
  );
}

function ClockScreen() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const position = useLivePosition();
  const { data: view, isPending, isError, error, refetch } = useClockStatus();
  const now = useServerNow(view?.offsetMs ?? 0, !!view && view.state !== 'IDLE');
  const [photo, setPhoto] = useState<{ id: string; which: 'start' | 'end' } | null>(null);
  // QR del cartel: llega en el enlace (?l=…&k=…) al escanearlo con la cámara del móvil, o desde el lector de la app.
  const [params, setParams] = useSearchParams();
  const [qr, setQr] = useState<QrTarget | null>(() => parseLocationQr(`/clock?${params.toString()}`));
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    if (params.has('k')) setParams({}, { replace: true });
  }, [params, setParams]);

  const scanned = (text: string): void => {
    const target = parseLocationQr(text);
    if (!target) {
      toast.error(t('clock.qrInvalid'));
      return;
    }
    setScanning(false);
    setQr(target);
  };

  return (
    <>
      <LocationChip position={position} />
      {qr ? (
        <QrChip qr={qr} onRemove={() => setQr(null)} />
      ) : (
        ws.kind === 'organization' && (
          <div className="-mt-1 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setScanning(true)} icon={<ScanLine className="size-4" />}>
              {t('clock.scanQr')}
            </Button>
          </div>
        )
      )}

      {isPending ? (
        <Card className="flex justify-center py-24 text-fg-subtle">
          <Spinner className="size-7" />
        </Card>
      ) : isError || !view ? (
        <Card className="space-y-3 p-6 text-center">
          <p className="font-semibold">{errorMessage(t, error)}</p>
          <Button variant="secondary" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </Card>
      ) : (
        <>
          <HandoverNotes notes={view.notes} />
          <Hero view={view} position={position} qr={qr} onQrUsed={() => setQr(null)} />
          {view.workday && (
            <section aria-labelledby="today-title" className="pt-2">
              <SectionTitle id="today-title" className="mb-2.5">
                {t('clock.today')}
              </SectionTitle>
              <Card className="overflow-hidden">
                <Timeline day={view.workday} now={now} onPhoto={(id, which) => setPhoto({ id, which })} />
              </Card>
            </section>
          )}
          {ws.kind === 'organization' && <SentHandoverNotes />}
          <div className="pt-2">
            <History openId={view.workday?.id ?? null} now={now} onPhoto={(id, which) => setPhoto({ id, which })} />
          </div>
        </>
      )}

      <PhotoSheet target={photo} onClose={() => setPhoto(null)} />
      <QrScanner open={scanning} onClose={() => setScanning(false)} onResult={scanned} />
    </>
  );
}
