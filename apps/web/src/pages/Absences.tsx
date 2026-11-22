import {
  ABSENCE_TYPES,
  type AbsenceDto,
  absenceDays,
  type AbsenceTypeId,
  type HolidayDto,
  type MemberDto,
  type TeamCalendar,
  type VacationBalance,
} from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarOff, ChevronLeft, ChevronRight, CircleAlert, Paperclip, Plus } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { addMonths, isoDate, startOfMonth } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';
import { Field } from '../ui/Field';
import { EmptyState, PageHeader } from '../ui/Page';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';
import { selectClass, Switch, textareaClass } from '../ui/Switch';

/** Color de cada tipo de ausencia (fondo suave + texto), coherente en listas y calendario. */
export const ABSENCE_TONE: Record<AbsenceTypeId, string> = {
  VACATION: 'bg-accent-soft text-accent-text',
  PERSONAL: 'bg-warning-soft text-warning-text',
  SICK_LEAVE: 'bg-danger-soft text-danger-text',
  PAID_LEAVE: 'bg-success-soft text-success-text',
  UNPAID: 'bg-surface-2 text-fg-muted',
  OTHER: 'bg-surface-2 text-fg-muted',
};
/** Color intenso para las celdas del calendario y su leyenda (se distinguen a simple vista). */
const CELL_TONE: Record<AbsenceTypeId, string> = {
  VACATION: 'bg-accent',
  PERSONAL: 'bg-warning',
  SICK_LEAVE: 'bg-danger',
  PAID_LEAVE: 'bg-success',
  UNPAID: 'bg-fg-subtle',
  OTHER: 'bg-fg-subtle',
};
const STATUS_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' } as const;

const utcDate = (d: string): Date => new Date(`${d}T12:00:00Z`);

/** «3 – 7 mar» · «28 feb – 3 mar» · «lun 3 mar». */
export function formatRange(start: string, end: string, lang: string | undefined): string {
  const day = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (start === end)
    return new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utcDate(start));
  return `${day.format(utcDate(start))} – ${day.format(utcDate(end))}`;
}

const days = (n: number, lang: string | undefined): string => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(n);

function useBalance(year: number) {
  const workspaceId = useSession((s) => s.workspaceId);
  return useQuery({
    queryKey: ['absences', 'balance', workspaceId, year],
    queryFn: () => api<VacationBalance>(`/absences/balance?year=${year}`),
  });
}

function BalanceCard() {
  const { t, i18n } = useTranslation();
  const year = new Date().getFullYear();
  const { data } = useBalance(year);
  if (!data) return <Card className="h-32 animate-pulse" />;
  const pct = data.allowance > 0 ? Math.min(100, (data.used / data.allowance) * 100) : 0;
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-sm font-medium text-fg-muted">{t('absences.balanceTitle', { year })}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
        {days(data.remaining, i18n.resolvedLanguage)}{' '}
        <span className="text-base font-medium text-fg-muted">{t('absences.ofDays', { count: data.allowance })}</span>
      </p>
      <p className="text-sm text-fg-muted">{t(data.unit === 'WORKING' ? 'absences.unitWorking' : 'absences.unitNatural')}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="presentation">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-surface-2/70 py-2">
          <dt className="text-xs text-fg-muted">{t('absences.used')}</dt>
          <dd className="font-bold tabular-nums">{days(data.used, i18n.resolvedLanguage)}</dd>
        </div>
        <div className="rounded-xl bg-surface-2/70 py-2">
          <dt className="text-xs text-fg-muted">{t('absences.pendingDays')}</dt>
          <dd className="font-bold tabular-nums">{days(data.pending, i18n.resolvedLanguage)}</dd>
        </div>
      </dl>
    </Card>
  );
}

function AbsenceRow({ a, showPerson, onCancel }: { a: AbsenceDto; showPerson?: boolean; onCancel?: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {showPerson && <Avatar name={a.user.fullName} size="sm" />}
      <span
        className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold', ABSENCE_TONE[a.type])}
        aria-hidden="true"
      >
        {days(a.days, lang)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{showPerson ? a.user.fullName : t(`absences.type.${a.type}`)}</p>
        <p className="text-sm text-fg-muted">
          {showPerson && `${t(`absences.type.${a.type}`)} · `}
          {formatRange(a.startDate, a.endDate, lang)}
          {a.halfDay && ` · ${t('absences.halfDay')}`} · {t('absences.days', { count: a.days })}
        </p>
        {a.status === 'REJECTED' && a.rejectionReason && <p className="mt-0.5 text-sm text-danger-text">{a.rejectionReason}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={STATUS_TONE[a.status]}>{t(`absences.status.${a.status}`)}</Badge>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={`${t('absences.cancel')}: ${formatRange(a.startDate, a.endDate, lang)}`}
            className="focus-ring rounded-md px-1 text-sm font-semibold text-accent-text hover:underline"
          >
            {t('absences.cancel')}
          </button>
        )}
      </div>
    </li>
  );
}

function MyAbsences() {
  const { t } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const year = new Date().getFullYear();
  const today = isoDate(new Date());
  const list = useQuery({
    queryKey: ['absences', 'mine', workspaceId, year],
    queryFn: () => api<AbsenceDto[]>(`/absences?from=${year}-01-01&to=${year + 1}-12-31`),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api<AbsenceDto>(`/absences/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['absences'] });
      toast.success(t('absences.cancelled'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const rows = list.data ?? [];
  return (
    <section aria-labelledby="mine-title">
      <SectionTitle id="mine-title" className="mb-2.5">
        {t('absences.mine')}
      </SectionTitle>
      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="flex justify-center py-10 text-fg-subtle">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<CalendarOff />} title={t('absences.emptyTitle')} body={t('absences.emptyBody')} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((a) => (
              <AbsenceRow
                key={a.id}
                a={a}
                onCancel={
                  a.status === 'PENDING' || (a.status === 'APPROVED' && a.startDate > today) ? () => cancel.mutate(a.id) : undefined
                }
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function PendingCard({ a }: { a: AbsenceDto }) {
  const { t, i18n } = useTranslation();
  const [removeShifts, setRemoveShifts] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const review = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') =>
      api<AbsenceDto>(`/absences/${a.id}/review`, {
        method: 'POST',
        body: decision === 'APPROVE' ? { decision, removeShifts } : { decision, reason },
      }),
    onSuccess: (_, decision) => {
      for (const key of ['absences', 'shifts', 'dashboard', 'hours']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(decision === 'APPROVE' ? t('absences.approved') : t('absences.rejected'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const openAttachment = async (): Promise<void> => {
    try {
      const { url } = await api<{ url: string }>(`/absences/${a.id}/attachment`);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(errorMessage(t, e));
    }
  };
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={a.user.fullName} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{a.user.fullName}</p>
          <p className="text-sm text-fg-muted">
            {formatRange(a.startDate, a.endDate, i18n.resolvedLanguage)} · {t('absences.days', { count: a.days })}
          </p>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', ABSENCE_TONE[a.type])}>{t(`absences.type.${a.type}`)}</span>
      </div>
      {a.reason && <p className="rounded-xl bg-surface-2/70 px-3 py-2 text-sm">{a.reason}</p>}
      {a.hasAttachment && (
        <Button variant="secondary" size="sm" onClick={() => void openAttachment()} icon={<Paperclip className="size-4" />}>
          {t('absences.attachment')}
        </Button>
      )}
      {a.conflictingShifts > 0 && (
        <div className="space-y-2 rounded-xl bg-warning-soft px-3 py-2.5 text-warning-text">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            {t('absences.conflicts', { count: a.conflictingShifts })}
          </p>
          <Switch checked={removeShifts} onChange={setRemoveShifts} label={t('absences.removeShifts', { count: a.conflictingShifts })} />
        </div>
      )}
      {rejecting ? (
        <div className="space-y-2">
          <label htmlFor={`reject-${a.id}`} className="block text-sm font-medium">
            {t('absences.rejectReason')}
          </label>
          <textarea
            id={`reject-${a.id}`}
            className={cn(textareaClass, 'min-h-20')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" disabled={reason.trim().length < 5} loading={review.isPending} onClick={() => review.mutate('REJECT')}>
              {t('absences.reject')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setRejecting(true)}>
            {t('absences.reject')}
          </Button>
          <Button loading={review.isPending} onClick={() => review.mutate('APPROVE')}>
            {t('absences.approve')}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Pending() {
  const { t } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const list = useQuery({ queryKey: ['absences', 'pending', workspaceId], queryFn: () => api<AbsenceDto[]>('/absences/pending') });
  if (list.isPending) {
    return (
      <Card className="flex justify-center py-10 text-fg-subtle">
        <Spinner />
      </Card>
    );
  }
  if (!list.data?.length) {
    return (
      <Card>
        <EmptyState icon={<CalendarOff />} title={t('absences.noPendingTitle')} body={t('absences.noPendingBody')} />
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {list.data.map((a) => (
        <PendingCard key={a.id} a={a} />
      ))}
    </div>
  );
}

/** Mes del equipo: una fila por persona y una columna por día, con festivos y ausencias. */
function TeamMonth() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const from = isoDate(month);
  const to = isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const cal = useQuery({
    queryKey: ['absences', 'calendar', workspaceId, from],
    queryFn: () => api<TeamCalendar>(`/absences/calendar?from=${from}&to=${to}`),
  });
  const members = useQuery({ queryKey: ['members', workspaceId], queryFn: () => api<MemberDto[]>('/members') });
  const dates = useMemo(() => {
    const out: string[] = [];
    for (let d = 1; d <= Number(to.slice(8)); d++) out.push(`${from.slice(0, 8)}${String(d).padStart(2, '0')}`);
    return out;
  }, [from, to]);
  const people = (members.data ?? []).filter((m) => m.active && m.role !== 'INSPECTOR');
  const holiday = (d: string): HolidayDto | undefined => cal.data?.holidays.find((h) => h.date === d && !h.location);
  const absenceOn = (userId: string, d: string): AbsenceDto | undefined =>
    cal.data?.absences.find((a) => a.user.id === userId && a.startDate <= d && a.endDate >= d);
  const weekend = (d: string): boolean => [0, 6].includes(utcDate(d).getUTCDay());
  const today = isoDate(new Date());
  const monthHolidays = cal.data?.holidays ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMonth(addMonths(month, -1))}
          aria-label={t('absences.prevMonth')}
          icon={<ChevronLeft className="size-5" />}
        />
        <p className="font-semibold first-letter:uppercase">
          {new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(month)}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMonth(addMonths(month, 1))}
          aria-label={t('absences.nextMonth')}
          icon={<ChevronRight className="size-5" />}
        />
      </div>
      <Card className="overflow-x-auto">
        {cal.isPending || members.isPending ? (
          <div className="flex justify-center py-12 text-fg-subtle">
            <Spinner />
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <caption className="sr-only">{t('absences.calendarCaption')}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-36 bg-surface px-3 py-2 text-left font-semibold text-fg-subtle uppercase"
                >
                  {t('shifts.person')}
                </th>
                {dates.map((d) => {
                  const h = holiday(d);
                  return (
                    <th
                      key={d}
                      scope="col"
                      title={h?.name}
                      className={cn(
                        'min-w-7 px-0.5 py-2 text-center font-semibold tabular-nums',
                        weekend(d) || h ? 'bg-surface-2 text-fg-subtle' : 'text-fg-muted',
                        d === today && 'text-accent-text',
                      )}
                    >
                      {Number(d.slice(8))}
                      {h && <span className="block text-[9px] leading-none text-danger-text">{t('absences.holidayShort')}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.userId} className="edge-t">
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-normal">
                    <span className="block max-w-40 truncate text-sm font-semibold">{p.fullName}</span>
                  </th>
                  {dates.map((d) => {
                    const a = absenceOn(p.userId, d);
                    return (
                      <td key={d} className={cn('h-9 border-l border-border p-0.5', (weekend(d) || holiday(d)) && 'bg-surface-2/60')}>
                        {a && (
                          <span
                            title={`${t(`absences.type.${a.type}`)} · ${t(`absences.status.${a.status}`)}`}
                            className={cn('block h-full rounded-md', CELL_TONE[a.type], a.status === 'PENDING' && 'opacity-40')}
                          >
                            <span className="sr-only">{`${p.fullName}: ${t(`absences.type.${a.type}`)}, ${t(`absences.status.${a.status}`)}`}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-fg-muted">
        {ABSENCE_TYPES.slice(0, 4).map((type) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <span className={cn('size-3 rounded', CELL_TONE[type])} />
            {t(`absences.type.${type}`)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded bg-accent opacity-40" />
          {t('absences.status.PENDING')}
        </span>
      </p>
      {monthHolidays.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">{t('absences.monthHolidays')}</p>
          <ul className="space-y-1 text-sm">
            {monthHolidays.map((h) => (
              <li key={h.id} className="flex gap-2">
                <span className="w-20 shrink-0 text-fg-muted tabular-nums">{formatRange(h.date, h.date, lang)}</span>
                <span>
                  {h.name}
                  {h.location && <span className="text-fg-muted"> · {h.location.name}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Próximos festivos de la empresa, para quien no ve el calendario del equipo. */
function UpcomingHolidays() {
  const { t, i18n } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const year = new Date().getFullYear();
  const list = useQuery({ queryKey: ['holidays', workspaceId, year], queryFn: () => api<HolidayDto[]>(`/holidays?year=${year}`) });
  const next = useQuery({ queryKey: ['holidays', workspaceId, year + 1], queryFn: () => api<HolidayDto[]>(`/holidays?year=${year + 1}`) });
  const today = isoDate(new Date());
  const upcoming = [...(list.data ?? []), ...(next.data ?? [])].filter((h) => h.date >= today).slice(0, 6);
  if (!upcoming.length) return null;
  return (
    <section aria-labelledby="holidays-title">
      <SectionTitle id="holidays-title" className="mb-2.5">
        {t('absences.upcomingHolidays')}
      </SectionTitle>
      <Card className="divide-y divide-border">
        {upcoming.map((h) => (
          <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-24 shrink-0 text-sm text-fg-muted tabular-nums first-letter:uppercase">
              {formatRange(h.date, h.date, i18n.resolvedLanguage)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{h.name}</span>
              {h.location && <span className="block truncate text-xs text-fg-muted">{h.location.name}</span>}
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}

function RequestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const workspaceId = useSession((s) => s.workspaceId);
  const supervisor = ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');
  const [type, setType] = useState<AbsenceTypeId>('VACATION');
  const [start, setStart] = useState(() => isoDate(new Date()));
  const [end, setEnd] = useState(() => isoDate(new Date()));
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [userId, setUserId] = useState(me.id);
  const [busy, setBusy] = useState(false);
  const balance = useBalance(Number(start.slice(0, 4)));
  const holidays = useQuery({
    queryKey: ['holidays', workspaceId, start.slice(0, 4)],
    queryFn: () => api<HolidayDto[]>(`/holidays?year=${start.slice(0, 4)}`),
    enabled: open,
  });
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => api<MemberDto[]>('/members'),
    enabled: open && supervisor,
  });

  const valid = end >= start;
  const unit = type === 'VACATION' ? (balance.data?.unit ?? 'WORKING') : type === 'SICK_LEAVE' ? 'NATURAL' : 'WORKING';
  const set = new Set((holidays.data ?? []).filter((h) => !h.location).map((h) => h.date));
  const count = valid ? absenceDays(start, end, unit, set, halfDay && start === end) : 0;
  const after = type === 'VACATION' && userId === me.id && balance.data ? balance.data.remaining - balance.data.pending - count : null;

  const reset = (): void => {
    setType('VACATION');
    setHalfDay(false);
    setReason('');
    setFile(null);
    setUserId(me.id);
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const form = new FormData();
    form.append(
      'data',
      JSON.stringify({
        type,
        startDate: start,
        endDate: end,
        halfDay: halfDay && start === end,
        reason: reason.trim() || undefined,
        ...(userId !== me.id ? { userId } : {}),
      }),
    );
    if (file) form.append('attachment', file);
    try {
      const created = await api<AbsenceDto>('/absences', { method: 'POST', body: form });
      for (const key of ['absences', 'dashboard', 'hours']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(created.status === 'APPROVED' ? t('absences.registered') : t('absences.requested'));
      reset();
      onClose();
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('absences.requestTitle')}
      description={supervisor ? t('absences.requestDescSupervisor') : t('absences.requestDesc')}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        {supervisor && (
          <div>
            <label htmlFor="abs-person" className="mb-1.5 block text-sm font-medium">
              {t('absences.for')}
            </label>
            <select id="abs-person" className={selectClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value={me.id}>{t('absences.forMe')}</option>
              {(members.data ?? [])
                .filter((m) => m.active && m.userId !== me.id && m.role !== 'INSPECTOR')
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName}
                  </option>
                ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="abs-type" className="mb-1.5 block text-sm font-medium">
            {t('absences.typeLabel')}
          </label>
          <select id="abs-type" className={selectClass} value={type} onChange={(e) => setType(e.target.value as AbsenceTypeId)}>
            {ABSENCE_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`absences.type.${x}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t('absences.from')}
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (e.target.value > end) setEnd(e.target.value);
            }}
          />
          <Field
            label={t('absences.to')}
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
            error={valid ? undefined : t('absences.invalidRange')}
          />
        </div>
        {start === end && <Switch checked={halfDay} onChange={setHalfDay} label={t('absences.halfDay')} />}
        <div>
          <label htmlFor="abs-reason" className="mb-1.5 block text-sm font-medium">
            {t('absences.reason')}
          </label>
          <textarea
            id="abs-reason"
            className={cn(textareaClass, 'min-h-20')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
        </div>
        {type !== 'VACATION' && (
          <div>
            <label htmlFor="abs-file" className="mb-1.5 block text-sm font-medium">
              {t('absences.attachmentLabel')}
            </label>
            <input
              id="abs-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-accent-soft file:px-4 file:py-2 file:font-semibold file:text-accent-text"
            />
          </div>
        )}
        <div className="rounded-2xl bg-surface-2/70 px-4 py-3 text-sm" aria-live="polite">
          <p className="font-semibold">{t('absences.willUse', { count })}</p>
          {after !== null && (
            <p className={after < 0 ? 'font-medium text-danger-text' : 'text-fg-muted'}>
              {after < 0 ? t('absences.overBalance', { count: -after }) : t('absences.leftAfter', { count: after })}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" block loading={busy} disabled={!valid || count === 0} icon={<Plus className="size-5" />}>
          {supervisor ? t('absences.submitSupervisor') : t('absences.submit')}
        </Button>
      </form>
    </Sheet>
  );
}

export function Absences() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [requesting, setRequesting] = useState(false);
  const role = ws.kind === 'organization' ? ws.role : null;
  const supervisor = role === 'ADMIN' || role === 'MANAGER';
  const [tab, setTab] = useState<'pending' | 'calendar' | 'mine'>(supervisor ? 'pending' : role === 'INSPECTOR' ? 'calendar' : 'mine');

  if (ws.kind !== 'organization') {
    return (
      <div className="animate-page">
        <PageHeader title={t('nav.absences')} />
        <Card>
          <EmptyState icon={<CalendarOff />} title={t('nav.absences')} body={t('absences.onlyOrg')} />
        </Card>
      </div>
    );
  }

  const tabs = [
    ...(supervisor ? [{ value: 'pending' as const, label: t('absences.tabPending') }] : []),
    ...(supervisor || role === 'INSPECTOR' ? [{ value: 'calendar' as const, label: t('absences.tabCalendar') }] : []),
    ...(role !== 'INSPECTOR' ? [{ value: 'mine' as const, label: t('absences.tabMine') }] : []),
  ];

  return (
    <div className="animate-page space-y-5">
      <PageHeader
        title={t('nav.absences')}
        action={
          role !== 'INSPECTOR' && (
            <Button onClick={() => setRequesting(true)} icon={<Plus className="size-4" />}>
              {t('absences.request')}
            </Button>
          )
        }
      />
      {tabs.length > 1 && <Segmented label={t('absences.view')} value={tab} onChange={setTab} options={tabs} />}
      {tab === 'pending' && <Pending />}
      {tab === 'calendar' && <TeamMonth />}
      {tab === 'mine' && (
        <>
          <BalanceCard />
          <MyAbsences />
          <UpcomingHolidays />
        </>
      )}
      <RequestSheet open={requesting} onClose={() => setRequesting(false)} />
    </div>
  );
}
