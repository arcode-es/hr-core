import type { PersonRef, ReviewItem, TeamDayRow, UserHours, WorkdayDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronLeft, ChevronRight, CircleCheck, History, PencilLine, Plus, TriangleAlert, Users, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { addMonths, formatHours, startOfMonth } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { formatDay, formatDuration, formatTime } from '../lib/format';
import { queryClient } from '../lib/query';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { AuditSheet } from '../time/AuditSheet';
import { PhotoSheet, Timeline } from '../time/Timeline';
import { WorkdayFormSheet } from '../time/WorkdayForm';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState, PageHeader } from '../ui/Page';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';

export const reviewKey = (workspaceId: string) => ['review', workspaceId] as const;

/** Jornadas pendientes de validar; lo usa también el contador del menú. */
export function usePendingReviews() {
  const workspaceId = useSession((s) => s.workspaceId);
  const ws = useWorkspace();
  const canReview = ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');
  return useQuery({
    queryKey: reviewKey(workspaceId),
    queryFn: () => api<ReviewItem[]>('/time/review'),
    enabled: canReview,
    refetchInterval: 120_000,
  });
}

// ── Pendientes ───────────────────────────────────────────────────────────

function Range({ day, muted }: { day: WorkdayDto; muted?: boolean }) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  return (
    <span className={cn('tabular-nums', muted && 'text-fg-muted line-through decoration-fg-subtle')}>
      {formatTime(day.startedAt, lang)} – {day.endedAt ? formatTime(day.endedAt, lang) : '…'}
      <span className={cn('ml-2 font-bold', muted && 'font-normal')}>{formatDuration(day.workedSeconds)}</span>
    </span>
  );
}

function PendingList() {
  const { t, i18n } = useTranslation();
  const me = useSession((s) => s.user)!;
  const { data, isPending } = usePendingReviews();
  const [rejecting, setRejecting] = useState<ReviewItem | null>(null);
  const [reason, setReason] = useState('');

  const decide = useMutation({
    mutationFn: (v: { id: string; decision: 'APPROVE' | 'REJECT'; reason?: string }) =>
      api<void>(`/time/review/${v.id}`, { method: 'POST', body: { decision: v.decision, reason: v.reason } }),
    onSuccess: (_, v) => {
      for (const key of ['review', 'team-day', 'workdays']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(t(v.decision === 'APPROVE' ? 'review.approved' : 'review.rejected'));
      setRejecting(null);
      setReason('');
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  if (isPending) {
    return (
      <div className="flex justify-center py-16 text-fg-subtle">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!data?.length) {
    return (
      <Card>
        <EmptyState icon={<CircleCheck />} title={t('review.emptyTitle')} body={t('review.emptyBody')} />
      </Card>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {data.map((item) => {
          const own = item.user.id === me.id;
          const busy = decide.isPending && decide.variables?.id === item.proposal.id;
          return (
            <li key={item.proposal.id}>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={item.user.fullName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{item.user.fullName}</p>
                    <p className="text-sm text-fg-muted first-letter:uppercase">{formatDay(item.proposal.startedAt, i18n.resolvedLanguage)}</p>
                  </div>
                  <Badge tone={item.original ? 'accent' : 'neutral'}>{t(item.original ? 'review.kindCorrection' : 'review.kindManual')}</Badge>
                </div>

                <div className="edge mt-3 space-y-1.5 rounded-2xl bg-surface-2/50 px-3.5 py-3 text-sm">
                  {item.original && (
                    <p className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-xs font-semibold text-fg-subtle uppercase">{t('review.before')}</span>
                      <Range day={item.original} muted />
                    </p>
                  )}
                  <p className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-xs font-semibold text-fg-subtle uppercase">
                      {t(item.original ? 'review.after' : 'review.declared')}
                    </span>
                    <Range day={item.proposal} />
                  </p>
                  {item.proposal.breakSeconds + item.proposal.travelSeconds > 0 && (
                    <p className="pl-16 text-xs text-fg-muted">
                      {t('review.breaks', { time: formatDuration(item.proposal.breakSeconds + item.proposal.travelSeconds) })}
                    </p>
                  )}
                </div>

                <p className="mt-3 text-sm">
                  <span className="text-fg-muted">{t('review.reason')}: </span>“{item.reason}”
                </p>

                {own ? (
                  <p className="mt-3 text-sm text-fg-muted">{t('review.ownNotice')}</p>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    <Button variant="secondary" disabled={busy} onClick={() => setRejecting(item)} icon={<X className="size-4" />}>
                      {t('review.reject')}
                    </Button>
                    <Button
                      loading={busy}
                      onClick={() => decide.mutate({ id: item.proposal.id, decision: 'APPROVE' })}
                      icon={<Check className="size-4" />}
                    >
                      {t('review.approve')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <Sheet
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={t('review.rejectTitle')}
        description={rejecting ? t('review.rejectDesc', { name: rejecting.user.fullName }) : undefined}
      >
        <form
          className="space-y-3 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (rejecting && reason.trim().length >= 5) decide.mutate({ id: rejecting.proposal.id, decision: 'REJECT', reason: reason.trim() });
          }}
        >
          <textarea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('review.rejectPlaceholder')}
            aria-label={t('review.reason')}
            className="edge w-full rounded-control bg-surface px-3.5 py-3 text-base placeholder:text-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none"
          />
          <Button type="submit" variant="danger" size="lg" block loading={decide.isPending} disabled={reason.trim().length < 5}>
            {t('review.rejectConfirm')}
          </Button>
        </form>
      </Sheet>
    </>
  );
}

// ── Equipo por día ───────────────────────────────────────────────────────

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function TeamDay({ canEdit }: { canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<{ workday: WorkdayDto | null; user: PersonRef } | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ id: string; which: 'start' | 'end' } | null>(null);

  const isToday = day.getTime() === startOfDay(new Date()).getTime();
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  const { data, isPending } = useQuery({
    queryKey: ['team-day', workspaceId, day.getTime()],
    queryFn: () => api<TeamDayRow[]>(`/time/team?from=${day.toISOString()}&to=${next.toISOString()}`),
    refetchInterval: isToday ? 60_000 : false,
  });

  const shift = (days: number): void => setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + days));
  const row = data?.find((r) => r.user.id === selected) ?? null;
  const label = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(day);
  const working = data?.filter((r) => r.state !== 'IDLE').length ?? 0;

  return (
    <>
      <Card className="mb-3 flex items-center gap-1 p-1.5">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label={t('team2.prevDay')}
          className="focus-ring flex size-11 items-center justify-center rounded-xl text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-semibold first-letter:uppercase">{isToday ? t('team2.today') : label}</p>
          <p className="truncate text-xs text-fg-muted first-letter:uppercase">
            {isToday ? `${label} · ${t('team2.workingNow', { count: working })}` : ' '}
          </p>
        </div>
        <button
          type="button"
          onClick={() => shift(1)}
          disabled={isToday}
          aria-label={t('team2.nextDay')}
          className="focus-ring flex size-11 items-center justify-center rounded-xl text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30"
        >
          <ChevronRight className="size-5" />
        </button>
      </Card>

      <Card className="overflow-hidden">
        {isPending ? (
          <div className="flex justify-center py-14 text-fg-subtle">
            <Spinner className="size-6" />
          </div>
        ) : (
          <ul>
            {(data ?? []).map((r, i) => {
              const worked = r.workdays.reduce((s, d) => s + d.workedSeconds, 0);
              const first = r.workdays[0];
              const last = r.workdays[r.workdays.length - 1];
              const flagged = r.workdays.some((d) => d.segments.some((s) => s.isWithinGeofence === false || s.photoMissing));
              const late = r.workdays.find((d) => d.lateMinutes !== null)?.lateMinutes ?? null;
              const pending = r.workdays.some((d) => d.approvalStatus === 'PENDING');
              const active = isToday && r.state !== 'IDLE';
              return (
                <li key={r.user.id} className={cn(i > 0 && 'edge-t')}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.user.id)}
                    className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="relative">
                      <Avatar name={r.user.fullName} />
                      {active && (
                        <span
                          className={cn(
                            'absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-surface',
                            r.state === 'WORKING' ? 'bg-success' : 'bg-warning',
                          )}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.user.fullName}</span>
                      <span className="block truncate text-sm text-fg-muted tabular-nums">
                        {first
                          ? `${formatTime(first.startedAt, lang)} – ${last!.endedAt ? formatTime(last!.endedAt, lang) : t('clock.ongoing')}`
                          : t('team2.noEntries')}
                      </span>
                    </span>
                    {late !== null && <Badge tone="warning">{t('clock.late', { count: late })}</Badge>}
                    {pending && <Badge tone="warning">{t('manual.badgePending')}</Badge>}
                    {flagged && <TriangleAlert className="size-[18px] shrink-0 text-warning" aria-label={t('clock.flagged')} />}
                    {active ? (
                      <Badge tone={r.state === 'WORKING' ? 'success' : 'warning'}>{t(r.state === 'WORKING' ? 'clock.working' : 'clock.pause')}</Badge>
                    ) : (
                      first && <span className="shrink-0 font-bold tabular-nums">{formatDuration(worked)}</span>
                    )}
                    <ChevronRight className="size-5 shrink-0 text-fg-subtle" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Sheet open={!!row} onClose={() => setSelected(null)} title={row?.user.fullName ?? ''} description={label} className="sm:max-w-lg">
        {row && (
          <div className="space-y-3 pt-1">
            {row.workdays.length === 0 && <p className="py-4 text-center text-sm text-fg-muted">{t('team2.noEntries')}</p>}
            {row.workdays.map((d) => (
              <div key={d.id} className="edge overflow-hidden rounded-2xl">
                {d.lateMinutes !== null && (
                  <p className="edge-b bg-warning-soft px-4 py-2 text-sm font-semibold text-warning-text">{t('clock.late', { count: d.lateMinutes })}</p>
                )}
                <Timeline day={d} now={Date.now()} onPhoto={(id, which) => setPhoto({ id, which })} />
                <div className="edge-t flex gap-2 bg-surface-2/40 px-4 py-2.5">
                  {canEdit && d.approvalStatus === 'APPROVED' && d.endedAt && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelected(null);
                        setForm({ workday: d, user: row.user });
                      }}
                      icon={<PencilLine className="size-4" />}
                    >
                      {t('manual.correct')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setAudit(d.replacesWorkdayId ?? d.id)} icon={<History className="size-4" />}>
                    {t('audit.open')}
                  </Button>
                </div>
              </div>
            ))}
            {canEdit && (
              <Button
                variant="secondary"
                block
                onClick={() => {
                  setSelected(null);
                  setForm({ workday: null, user: row.user });
                }}
                icon={<Plus className="size-4" />}
              >
                {t('manual.add')}
              </Button>
            )}
          </div>
        )}
      </Sheet>

      <WorkdayFormSheet open={!!form} onClose={() => setForm(null)} workday={form?.workday} forUser={form?.user} />
      <AuditSheet workdayId={audit} onClose={() => setAudit(null)} />
      <PhotoSheet target={photo} onClose={() => setPhoto(null)} />
    </>
  );
}

// ── Bolsa de horas del equipo ────────────────────────────────────────────

function TeamHours() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const next = addMonths(month, 1);
  const isCurrent = month.getTime() === startOfMonth(new Date()).getTime();
  const { data, isPending } = useQuery({
    queryKey: ['hours', workspaceId, 'team', month.getTime()],
    queryFn: () => api<UserHours[]>(`/time/hours?scope=team&from=${month.toISOString()}&to=${next.toISOString()}`),
  });
  const h = (s: number): string => formatHours(s, lang);
  const columns: [string, (u: UserHours) => number, boolean][] = [
    [t('hours.planned'), (u) => u.total.plannedSeconds, false],
    [t('hours.worked'), (u) => u.total.workedSeconds, false],
    [t('hours.ordinary'), (u) => u.total.ordinarySeconds, false],
    [t('hours.overtime'), (u) => u.total.overtimeSeconds, true],
    [t('hours.night'), (u) => u.total.nightSeconds, false],
    [t('hours.travel'), (u) => u.total.travelSeconds, false],
  ];
  const arrow = 'focus-ring flex size-11 items-center justify-center rounded-xl text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30';

  return (
    <>
      <Card className="mb-3 flex items-center gap-1 p-1.5">
        <button type="button" onClick={() => setMonth(addMonths(month, -1))} aria-label={t('shifts.prev')} className={arrow}>
          <ChevronLeft className="size-5" />
        </button>
        <p className="flex-1 text-center font-semibold first-letter:uppercase">
          {new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(month)}
        </p>
        <button type="button" onClick={() => setMonth(next)} disabled={isCurrent} aria-label={t('shifts.next')} className={arrow}>
          <ChevronRight className="size-5" />
        </button>
      </Card>

      {isPending ? (
        <Card className="flex justify-center py-14 text-fg-subtle">
          <Spinner className="size-6" />
        </Card>
      ) : (
        <>
          {/* Escritorio: tabla comparable de un vistazo. */}
          <Card className="hidden overflow-hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="edge-b text-xs text-fg-subtle uppercase">
                  <th className="px-4 py-2.5 text-left font-semibold">{t('shifts.person')}</th>
                  {columns.map(([label]) => (
                    <th key={label} className="px-3 py-2.5 text-right font-semibold">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((u, i) => (
                  <tr key={u.user.id} className={cn(i > 0 && 'edge-t')}>
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={u.user.fullName} size="sm" />
                        <span className="truncate font-semibold">{u.user.fullName}</span>
                      </span>
                    </th>
                    {columns.map(([label, value, warn]) => (
                      <td key={label} className={cn('px-3 py-2.5 text-right tabular-nums', warn && value(u) > 0 && 'font-bold text-warning-text')}>
                        {h(value(u))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {/* Móvil: una tarjeta por persona. */}
          <ul className="space-y-3 sm:hidden">
            {(data ?? []).map((u) => (
              <li key={u.user.id}>
                <Card className="p-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={u.user.fullName} size="sm" />
                    <p className="truncate font-semibold">{u.user.fullName}</p>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {columns.map(([label, value, warn]) => (
                      <div key={label} className="rounded-xl bg-surface-2/70 px-1 py-2">
                        <dt className="truncate text-[11px] font-medium text-fg-muted">{label}</dt>
                        <dd className={cn('mt-0.5 text-sm font-bold tabular-nums', warn && value(u) > 0 && 'text-warning-text')}>{h(value(u))}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-fg-muted">{t('hours.teamNote')}</p>
        </>
      )}
    </>
  );
}

export function Timesheets() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const canReview = ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');
  const pending = usePendingReviews();
  const count = pending.data?.length ?? 0;
  const [tab, setTab] = useState<'pending' | 'team' | 'hours'>('team');

  if (ws.kind !== 'organization' || ws.role === 'EMPLOYEE') {
    return (
      <div className="animate-page">
        <PageHeader title={t('nav.timesheets')} />
        <Card>
          <EmptyState icon={<Users />} title={t('nav.timesheets')} body={t('team2.onlySupervisors')} />
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-page">
      <PageHeader title={t('nav.timesheets')} subtitle={ws.name} />
      {canReview && count > 0 && tab === 'team' && (
        <button
          type="button"
          onClick={() => setTab('pending')}
          className="focus-ring edge mb-3 flex w-full items-center gap-3 rounded-2xl bg-warning-soft px-4 py-3 text-left text-warning-text"
        >
          <TriangleAlert className="size-5 shrink-0" />
          <span className="flex-1 text-sm font-semibold">{t('review.banner', { count })}</span>
          <ArrowRight className="size-4" />
        </button>
      )}
      {!canReview && (
        <Segmented
          className="mb-4"
          label={t('nav.timesheets')}
          value={tab === 'pending' ? 'team' : tab}
          onChange={setTab}
          options={[
            { value: 'team', label: t('team2.tab') },
            { value: 'hours', label: t('hours.tab') },
          ]}
        />
      )}
      {canReview && (
        <Segmented
          className="mb-4"
          label={t('nav.timesheets')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'team', label: t('team2.tab') },
            { value: 'pending', label: count ? t('review.tabCount', { count }) : t('review.tab') },
            { value: 'hours', label: t('hours.tab') },
          ]}
        />
      )}
      {tab === 'hours' ? <TeamHours /> : tab === 'pending' && canReview ? <PendingList /> : <TeamDay canEdit={canReview} />}
    </div>
  );
}
