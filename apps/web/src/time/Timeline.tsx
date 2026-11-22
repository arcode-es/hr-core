import type { TimeSegmentDto, WorkdayDto } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, CameraOff, Car, CloudOff, Coffee, Image as ImageIcon, MapPin, MapPinOff, QrCode, Tablet, TriangleAlert, Utensils } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { formatDistance, formatDuration, formatTime } from '../lib/format';
import { Badge } from '../ui/Badge';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';

export const SEGMENT_ICON = { WORK: Briefcase, MEAL: Utensils, REST: Coffee, OTHER: Coffee, TRAVEL: Car } as const;

export const segmentKind = (s: TimeSegmentDto): keyof typeof SEGMENT_ICON =>
  s.entryType === 'WORK' ? 'WORK' : s.entryType === 'TRAVEL' ? 'TRAVEL' : (s.breakKind ?? 'REST');

export function PhotoSheet({ target, onClose }: { target: { id: string; which: 'start' | 'end' } | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery({
    queryKey: ['entry-photo', target?.id, target?.which],
    queryFn: () => api<{ url: string }>(`/time/entries/${target!.id}/photo/${target!.which}`),
    enabled: !!target,
    staleTime: 120_000,
  });
  return (
    <Sheet open={!!target} onClose={onClose} title={t('clock.photoTitle')}>
      <div className="flex min-h-48 items-center justify-center">
        {isPending ? (
          <Spinner className="size-6 text-fg-subtle" />
        ) : isError || !data ? (
          <p className="text-sm text-fg-muted">{t('errors.UNKNOWN')}</p>
        ) : (
          <img src={data.url} alt={t('clock.photoAlt')} className="max-h-[65dvh] w-full rounded-2xl object-contain" />
        )}
      </div>
    </Sheet>
  );
}

export function Timeline({ day, now, onPhoto }: { day: WorkdayDto; now: number; onPhoto: (id: string, which: 'start' | 'end') => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  return (
    <ol>
      {day.segments.map((s, i) => {
        const kind = segmentKind(s);
        const Icon = SEGMENT_ICON[kind];
        const seconds = Math.floor(((s.endTime ? Date.parse(s.endTime) : now) - Date.parse(s.startTime)) / 1000);
        const work = s.entryType === 'WORK';
        return (
          <li key={s.id} className={cn('flex gap-3 px-4 py-3', i > 0 && 'edge-t')}>
            <span
              className={cn(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl',
                work ? 'bg-accent-soft text-accent-text' : 'bg-warning-soft text-warning-text',
              )}
            >
              <Icon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-semibold">{t(`clock.kind_${kind}`)}</p>
                <p className="shrink-0 text-sm font-semibold tabular-nums">{formatDuration(seconds)}</p>
              </div>
              <p className="text-sm text-fg-muted tabular-nums">
                {formatTime(s.startTime, lang)} – {s.endTime ? formatTime(s.endTime, lang) : t('clock.ongoing')}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {s.locationName && s.isWithinGeofence && (
                  <Badge tone="success">
                    <MapPin className="size-3" />
                    {s.locationName}
                  </Badge>
                )}
                {s.isWithinGeofence === false && (
                  <Badge tone="warning">
                    <TriangleAlert className="size-3" />
                    {t('clock.outsideShort', { distance: formatDistance(s.geofenceDistanceMeters ?? 0, lang), name: s.locationName })}
                  </Badge>
                )}
                {s.id.startsWith('local-') && (
                  <Badge tone="accent">
                    <CloudOff className="size-3" />
                    {t('offline.pendingBadge')}
                  </Badge>
                )}
                {s.syncedOffline && !s.id.startsWith('local-') && (
                  <Badge>
                    <CloudOff className="size-3" />
                    {t('offline.syncedBadge')}
                  </Badge>
                )}
                {s.presenceMethod === 'QR' && (
                  <Badge tone="success">
                    <QrCode className="size-3" />
                    {t('clock.viaQr')}
                  </Badge>
                )}
                {s.presenceMethod === 'KIOSK' && (
                  <Badge tone="success">
                    <Tablet className="size-3" />
                    {t('clock.viaKiosk')}
                  </Badge>
                )}
                {s.photoMissing && (
                  <Badge tone="warning">
                    <CameraOff className="size-3" />
                    {t('clock.photoMissing')}
                  </Badge>
                )}
                {!s.hasPosition && s.presenceMethod === 'NONE' && (
                  <Badge tone="warning">
                    <MapPinOff className="size-3" />
                    {t('clock.noPosition')}
                  </Badge>
                )}
                {(['start', 'end'] as const).map(
                  (which) =>
                    (which === 'start' ? s.hasStartPhoto : s.hasEndPhoto) && (
                      <button
                        key={which}
                        type="button"
                        onClick={() => onPhoto(s.id, which)}
                        className="focus-ring inline-flex h-6 items-center gap-1 rounded-full bg-surface-2 px-2.5 text-xs font-semibold text-fg-muted hover:text-fg contrast:border-2 contrast:border-current"
                      >
                        <ImageIcon className="size-3" />
                        {t(`clock.photo_${which}`)}
                      </button>
                    ),
                )}
              </div>
              {s.startAddress && <p className="mt-1 truncate text-xs text-fg-subtle">{s.startAddress}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

