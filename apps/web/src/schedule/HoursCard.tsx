import type { HoursBag } from '@hr/shared';
import { useTranslation } from 'react-i18next';
import { formatHours } from '../lib/dates';
import { Card } from '../ui/Card';

/** Bolsa de horas de un periodo: avance sobre lo planificado y desglose por tipo. */
export function HoursCard({ bag, hasPlan, loading }: { bag: HoursBag | undefined; hasPlan: boolean; loading: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const h = (s: number): string => formatHours(s, lang);
  const b = bag ?? { plannedSeconds: 0, workedSeconds: 0, ordinarySeconds: 0, overtimeSeconds: 0, nightSeconds: 0, travelSeconds: 0, breakSeconds: 0, absenceSeconds: 0 };
  const pct = b.plannedSeconds > 0 ? Math.min(100, (b.workedSeconds / b.plannedSeconds) * 100) : 0;

  const stats: [string, number, string][] = [
    [t('hours.ordinary'), b.ordinarySeconds, 'text-fg'],
    [t('hours.overtime'), b.overtimeSeconds, b.overtimeSeconds > 0 ? 'text-warning-text' : 'text-fg'],
    [t('hours.night'), b.nightSeconds, 'text-fg'],
    [t('hours.travel'), b.travelSeconds, 'text-fg'],
  ];

  return (
    <Card className={loading ? 'animate-pulse p-4' : 'p-4'}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-3xl font-bold tracking-tight tabular-nums">{h(b.workedSeconds)}</p>
        <p className="text-right text-sm text-fg-muted">{hasPlan ? t('hours.ofPlanned', { hours: h(b.plannedSeconds) }) : t('hours.noPlan')}</p>
      </div>
      {hasPlan && (
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-2 contrast:border contrast:border-black" role="presentation">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
      {b.absenceSeconds > 0 && <p className="mt-2 text-sm text-fg-muted">{t('hours.absence', { hours: h(b.absenceSeconds) })}</p>}
      <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
        {stats.map(([label, seconds, tone]) => (
          <div key={label} className="rounded-xl bg-surface-2/70 px-1 py-2.5">
            <dt className="truncate text-[11px] font-medium text-fg-muted">{label}</dt>
            <dd className={`mt-0.5 text-sm font-bold tabular-nums ${tone}`}>{h(seconds)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
