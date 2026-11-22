import type { AlertDto, AlertKindId, OrganizationDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BedDouble, Check, Clock4, Hourglass, type LucideIcon, ShieldCheck, Timer, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { formatTime } from '../lib/format';
import { queryClient } from '../lib/query';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/Page';
import { Segmented } from '../ui/Segmented';
import { Spinner } from '../ui/Spinner';
import { formatRange } from './Absences';

const ICON: Record<AlertKindId, LucideIcon> = {
  MISSED_CLOCK_IN: Clock4,
  LONG_WORKDAY: Hourglass,
  SHORT_REST: BedDouble,
  LONG_ORDINARY_DAY: Timer,
  OVERTIME_YEAR_70: TrendingUp,
  OVERTIME_YEAR_100: TrendingUp,
};

/** Artículo del Estatuto de los Trabajadores en que se basa cada alerta (las de registro no tienen). */
const LAW: Partial<Record<AlertKindId, string>> = {
  SHORT_REST: 'art. 34.3 ET',
  LONG_ORDINARY_DAY: 'art. 34.3 ET',
  OVERTIME_YEAR_70: 'art. 35.2 ET',
  OVERTIME_YEAR_100: 'art. 35.2 ET',
  MISSED_CLOCK_IN: 'art. 34.9 ET',
  LONG_WORKDAY: 'art. 34.9 ET',
};

const severe = (k: AlertKindId): boolean => k === 'SHORT_REST' || k === 'OVERTIME_YEAR_100' || k === 'LONG_ORDINARY_DAY';

/** Alertas de jornada de la empresa: quien supervisa las revisa y las da por resueltas. */
export function Alerts() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const ws = useWorkspace();
  const workspaceId = useSession((s) => s.workspaceId);
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const allowed = ws.kind === 'organization' && ws.role !== 'EMPLOYEE';
  const canResolve = ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');
  const { data, isPending } = useQuery({
    queryKey: ['alerts', workspaceId, status],
    queryFn: () => api<AlertDto[]>(`/alerts?status=${status}`),
    enabled: allowed,
    refetchInterval: 120_000,
  });
  const org = useQuery({
    queryKey: ['organization', workspaceId],
    queryFn: () => api<OrganizationDto>('/organization'),
    enabled: ws.kind === 'organization' && ws.role === 'ADMIN',
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api<AlertDto>(`/alerts/${id}/resolve`, { method: 'POST' }),
    onSuccess: () => {
      for (const key of ['alerts', 'dashboard']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(t('alerts.resolvedToast'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  if (!allowed) return <Navigate to="/" replace />;

  const detail = (a: AlertDto): string =>
    t(`alerts.detail.${a.kind}`, {
      hours: a.data.hours?.toLocaleString(lang),
      limit: a.data.limit,
      time: a.data.plannedStart ? formatTime(a.data.plannedStart, lang) : '',
    });

  return (
    <div className="animate-page space-y-4">
      <PageHeader title={t('alerts.title')} subtitle={t('alerts.subtitle')} />
      {org.data && !org.data.alertsEnabled && (
        <Link to="/company" className="focus-ring edge block rounded-2xl bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-text">
          {t('alerts.disabled')}
        </Link>
      )}
      <Segmented
        label={t('alerts.title')}
        value={status}
        onChange={setStatus}
        options={[
          { value: 'open', label: t('alerts.open') },
          { value: 'all', label: t('alerts.all') },
        ]}
      />
      <Card className="overflow-hidden">
        {isPending ? (
          <div className="flex justify-center py-14 text-fg-subtle">
            <Spinner className="size-6" />
          </div>
        ) : (data ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-success-soft text-success-text">
              <ShieldCheck className="size-6" />
            </span>
            <p className="text-sm font-medium text-fg-muted">{t(status === 'open' ? 'alerts.empty' : 'alerts.emptyAll')}</p>
          </div>
        ) : (
          <ul>
            {(data ?? []).map((a, i) => {
              const Icon = ICON[a.kind];
              const done = !!a.resolvedAt;
              return (
                <li key={a.id} className={cn('flex flex-wrap items-start gap-3 px-4 py-3.5', i > 0 && 'edge-t', done && 'opacity-70')}>
                  <span
                    className={cn(
                      'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl',
                      done ? 'bg-surface-2 text-fg-muted' : severe(a.kind) ? 'bg-danger-soft text-danger-text' : 'bg-warning-soft text-warning-text',
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  {/* En el móvil, el botón baja a su propia línea para no estrechar el texto. */}
                  <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-3.25rem)]">
                    <p className="font-semibold">{t(`alerts.kind.${a.kind}`)}</p>
                    <p className="mt-0.5 truncate text-sm font-medium">{a.user.fullName}</p>
                    <p className="mt-1 text-sm text-fg-muted">
                      <span className="first-letter:uppercase">{a.kind.startsWith('OVERTIME') ? a.date.slice(0, 4) : formatRange(a.date, a.date, lang)}</span>
                      {' · '}
                      {detail(a)}
                    </p>
                    {LAW[a.kind] && <p className="mt-0.5 text-xs text-fg-subtle">{t('alerts.law', { ref: LAW[a.kind] })}</p>}
                    {done && a.resolvedBy && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-success-text">
                        <Check className="size-3.5" />
                        {t('alerts.resolvedBy', { name: a.resolvedBy.fullName })}
                      </p>
                    )}
                  </div>
                  {!done && canResolve && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={resolve.isPending && resolve.variables === a.id}
                      onClick={() => resolve.mutate(a.id)}
                      icon={<Check className="size-4" />}
                      className="max-sm:ml-[3.25rem]"
                    >
                      {t('alerts.resolve')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
