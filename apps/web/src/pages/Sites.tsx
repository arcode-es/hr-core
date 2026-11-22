import type { SiteCostReport, SiteCostRow } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleAlert, Coins, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { api, apiDownload } from '../lib/api';
import { addMonths, startOfMonth } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { formatDuration } from '../lib/format';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';
import { PageHeader } from '../ui/Page';
import { Spinner } from '../ui/Spinner';

const total = (r: SiteCostRow): number => r.laborCost + r.expensesTotal;

/**
 * Barras horizontales del coste total de cada ubicación: una sola serie (sin
 * leyenda: el título la nombra), en el color de acento, con el importe al final
 * de cada barra y el desglose al pasar por encima o al enfocarla.
 */
function CostBars({ rows, money, label }: { rows: SiteCostRow[]; money: (n: number) => string; label: (r: SiteCostRow) => string }) {
  const { t } = useTranslation();
  const max = Math.max(...rows.map(total), 0);
  if (max <= 0) return null;
  return (
    <figure>
      <figcaption className="mb-3 text-sm font-semibold">{t('sites.chart')}</figcaption>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const value = total(r);
          const detail = `${label(r)}: ${money(value)} · ${t('sites.laborCost')} ${money(r.laborCost)} · ${t('sites.expenses')} ${money(r.expensesTotal)} · ${formatDuration(r.workedSeconds)}`;
          return (
            <li key={r.location?.id ?? 'none'} className="group relative" tabIndex={0} aria-label={detail}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-fg-muted">{label(r)}</span>
                <span className="shrink-0 font-semibold tabular-nums">{money(value)}</span>
              </div>
              <div className="mt-1 h-3 rounded-r bg-surface-2" aria-hidden="true">
                <div className="h-full rounded-r-[4px] bg-accent transition-[filter] group-hover:brightness-110" style={{ width: `${Math.max(1.5, (value / max) * 100)}%` }} />
              </div>
              <div
                role="tooltip"
                className="edge pointer-events-none absolute top-full left-0 z-10 mt-1 hidden w-max max-w-full rounded-xl bg-surface px-3 py-2 text-xs shadow-pop group-hover:block group-focus:block"
              >
                <p className="font-semibold">{label(r)}</p>
                <p className="text-fg-muted">
                  {t('sites.laborCost')}: <span className="font-semibold text-fg tabular-nums">{money(r.laborCost)}</span>
                </p>
                <p className="text-fg-muted">
                  {t('sites.expenses')}: <span className="font-semibold text-fg tabular-nums">{money(r.expensesTotal)}</span>
                </p>
                <p className="text-fg-muted">
                  {t('sites.hours')}: <span className="font-semibold text-fg tabular-nums">{formatDuration(r.workedSeconds)}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

/** Coste por obra: horas, coste estimado y gastos de cada ubicación en el mes (solo administración). */
export function Sites() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const ws = useWorkspace();
  const workspaceId = useSession((s) => s.workspaceId);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const monthParam = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const isAdmin = ws.kind === 'organization' && ws.role === 'ADMIN';
  const { data, isPending } = useQuery({
    queryKey: ['sites', workspaceId, monthParam],
    queryFn: () => api<SiteCostReport>(`/reports/sites?month=${monthParam}`),
    enabled: isAdmin,
  });
  const download = useMutation({
    mutationFn: () => apiDownload(`/reports/sites.xlsx?month=${monthParam}`, `coste-por-obra-${monthParam}.xlsx`),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  if (!isAdmin) return <Navigate to="/" replace />;

  const money = (n: number): string => new Intl.NumberFormat(lang, { style: 'currency', currency: data?.currency ?? 'EUR', maximumFractionDigits: 0 }).format(n);
  const label = (r: SiteCostRow): string => r.location?.name ?? t('sites.noLocation');
  const rows = [...(data?.rows ?? [])].sort((a, b) => total(b) - total(a));
  const arrow = 'focus-ring flex size-11 items-center justify-center rounded-xl text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30';
  const isCurrent = month.getTime() === startOfMonth(new Date()).getTime();

  return (
    <div className="animate-page space-y-4">
      <PageHeader
        title={t('sites.title')}
        subtitle={t('sites.subtitle')}
        action={
          <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()} icon={<FileSpreadsheet className="size-4" />}>
            <span className="max-sm:sr-only">{t('sites.download')}</span>
          </Button>
        }
      />
      <Card className="flex items-center gap-1 p-1.5">
        <button type="button" onClick={() => setMonth(addMonths(month, -1))} aria-label={t('shifts.prev')} className={arrow}>
          <ChevronLeft className="size-5" />
        </button>
        <p className="flex-1 text-center font-semibold first-letter:uppercase">{new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(month)}</p>
        <button type="button" onClick={() => setMonth(addMonths(month, 1))} disabled={isCurrent} aria-label={t('shifts.next')} className={arrow}>
          <ChevronRight className="size-5" />
        </button>
      </Card>

      {isPending || !data ? (
        <Card className="flex justify-center py-16 text-fg-subtle">
          <Spinner className="size-6" />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
            <Coins className="size-6" />
          </span>
          <p className="text-sm font-medium text-fg-muted">{t('sites.empty')}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              [t('sites.hours'), formatDuration(data.total.workedSeconds)],
              [t('sites.laborCost'), money(data.total.laborCost)],
              [t('sites.expenses'), money(data.total.expensesTotal)],
            ].map(([k, v]) => (
              <Card key={k} className="p-4">
                <p className="text-sm text-fg-muted">{k}</p>
                <p className="mt-1 text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{v}</p>
              </Card>
            ))}
          </div>

          {data.missingRates.length > 0 && (
            <p className="edge flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {t('sites.missingRates', { names: data.missingRates.map((p) => p.fullName).join(', ') })}
            </p>
          )}

          <Card className="p-4 sm:p-5">
            <CostBars rows={rows} money={money} label={label} />
          </Card>

          <section aria-labelledby="sites-table">
            <SectionTitle id="sites-table" className="mb-2.5">
              {t('sites.breakdown')}
            </SectionTitle>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="edge-b text-left text-xs text-fg-muted">
                    <th scope="col" className="px-4 py-2.5 font-semibold">{t('locations.title')}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">{t('sites.hours')}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">{t('sites.laborCost')}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">{t('sites.expenses')}</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">{t('sites.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.location?.id ?? 'none'} className="edge-b last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-medium">
                        <span className="block">{label(r)}</span>
                        <span className="block text-xs font-normal text-fg-muted">{t('sites.people', { count: r.people })}</span>
                      </th>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatDuration(r.workedSeconds)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(r.laborCost)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(r.expensesTotal)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{money(total(r))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
          <p className="text-sm text-fg-muted">{t('sites.estimate')}</p>
        </>
      )}
    </div>
  );
}
