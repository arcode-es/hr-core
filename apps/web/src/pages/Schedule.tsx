import type { AbsenceTypeId, MemberDto, PersonRef, ShiftDto, UserHours } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Copy, MapPin, Plus, Repeat, Send, StickyNote } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { addDays, addMonths, formatHours, isoDate, sameDay, startOfMonth, startOfWeek, weekLabel } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { formatDuration, formatTime } from '../lib/format';
import { queryClient } from '../lib/query';
import { absenceOn, holidayOn, useCalendar } from '../schedule/calendar';
import { HoursCard } from '../schedule/HoursCard';
import { ABSENCE_TONE } from './Absences';
import { type ShiftDraft, ShiftSheet } from '../schedule/ShiftSheet';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';
import { PageHeader } from '../ui/Page';
import { PatternsSheet } from '../schedule/Patterns';
import { Segmented } from '../ui/Segmented';
import { Spinner } from '../ui/Spinner';

const range = (from: Date, to: Date): string => `from=${from.toISOString()}&to=${to.toISOString()}`;

function useShifts(from: Date, to: Date) {
  const workspaceId = useSession((s) => s.workspaceId);
  return useQuery({
    queryKey: ['shifts', workspaceId, from.getTime(), to.getTime()],
    queryFn: () => api<ShiftDto[]>(`/shifts?${range(from, to)}`),
  });
}

const netSeconds = (s: ShiftDto): number => (Date.parse(s.plannedEnd) - Date.parse(s.plannedStart)) / 1000 - s.breakMinutes * 60;
const onDay = (shifts: ShiftDto[], day: Date): ShiftDto[] => shifts.filter((s) => sameDay(new Date(s.plannedStart), day));

// ── Navegación de periodo ────────────────────────────────────────────────

function PeriodNav({ label, onPrev, onNext, onToday, isCurrent }: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void; isCurrent: boolean }) {
  const { t } = useTranslation();
  const arrow = 'focus-ring flex size-11 shrink-0 items-center justify-center rounded-xl text-fg-muted hover:bg-surface-2 hover:text-fg';
  return (
    <Card className="flex items-center gap-1 p-1.5">
      <button type="button" onClick={onPrev} aria-label={t('shifts.prev')} className={arrow}>
        <ChevronLeft className="size-5" />
      </button>
      <p className="min-w-0 flex-1 truncate text-center font-semibold first-letter:uppercase">{label}</p>
      {!isCurrent && (
        <Button variant="ghost" size="sm" onClick={onToday}>
          {t('team2.today')}
        </Button>
      )}
      <button type="button" onClick={onNext} aria-label={t('shifts.next')} className={arrow}>
        <ChevronRight className="size-5" />
      </button>
    </Card>
  );
}

// ── Mi horario ───────────────────────────────────────────────────────────

function ShiftCard({ shift, onClick }: { shift: ShiftDto; onClick?: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const body = (
    <>
      <span className="w-1.5 shrink-0 self-stretch rounded-full" style={{ backgroundColor: shift.locationColor ?? 'var(--accent)' }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-bold tabular-nums">
            {formatTime(shift.plannedStart, lang)} – {formatTime(shift.plannedEnd, lang)}
          </span>
          <span className="shrink-0 text-sm text-fg-muted tabular-nums">{formatDuration(netSeconds(shift))}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-fg-muted">
          {shift.locationName && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {shift.locationName}
            </span>
          )}
          {shift.breakMinutes > 0 && <span>{t('shifts.breakShort', { minutes: shift.breakMinutes })}</span>}
        </span>
        {shift.notes && (
          <span className="mt-1 flex items-start gap-1 text-sm">
            <StickyNote className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
            {shift.notes}
          </span>
        )}
      </span>
    </>
  );
  const cls = 'edge flex w-full gap-3 rounded-2xl bg-surface p-3 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, 'focus-ring transition-colors hover:bg-surface-2')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function MySchedule() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const me = useSession((s) => s.user)!;
  const workspaceId = useSession((s) => s.workspaceId);
  const ws = useWorkspace();
  const personal = ws.kind === 'personal';
  const [monday, setMonday] = useState(() => startOfWeek(new Date()));
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [draft, setDraft] = useState<ShiftDraft | null>(null);

  const weekEnd = addDays(monday, 7);
  const shifts = useShifts(monday, weekEnd);
  const mine = (shifts.data ?? []).filter((s) => s.user.id === me.id);
  const calendar = useCalendar(monday, weekEnd).data;

  const month = startOfMonth(addDays(monday, 3));
  const [from, to] = period === 'week' ? [monday, weekEnd] : [month, addMonths(month, 1)];
  const hours = useQuery({
    queryKey: ['hours', workspaceId, 'me', from.getTime(), to.getTime()],
    queryFn: () => api<UserHours[]>(`/time/hours?${range(from, to)}`),
  });

  const today = new Date();
  const weekday = new Intl.DateTimeFormat(lang, { weekday: 'short' });

  return (
    <div className="space-y-4">
      <PeriodNav
        label={weekLabel(monday, lang)}
        onPrev={() => setMonday(addDays(monday, -7))}
        onNext={() => setMonday(addDays(monday, 7))}
        onToday={() => setMonday(startOfWeek(new Date()))}
        isCurrent={sameDay(monday, startOfWeek(new Date()))}
      />

      <section aria-labelledby="bag-title">
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <SectionTitle id="bag-title">{t('hours.title')}</SectionTitle>
          <Segmented
            className="w-44"
            label={t('hours.period')}
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'week', label: t('hours.week') },
              { value: 'month', label: t('hours.month') },
            ]}
          />
        </div>
        <HoursCard bag={hours.data?.[0]?.total} hasPlan={hours.data?.[0]?.hasPlan ?? false} loading={hours.isPending} />
      </section>

      <section aria-labelledby="agenda-title">
        <SectionTitle id="agenda-title" className="mb-2.5">
          {t('shifts.agenda')}
        </SectionTitle>
        <Card className="overflow-hidden">
          {shifts.isPending ? (
            <div className="flex justify-center py-14 text-fg-subtle">
              <Spinner className="size-6" />
            </div>
          ) : (
            <ul>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                const day = addDays(monday, i);
                const list = onDay(mine, day);
                const isToday = sameDay(day, today);
                return (
                  <li key={i} className={cn('flex gap-3 px-3 py-3 sm:px-4', i > 0 && 'edge-t', isToday && 'bg-accent-soft/50')}>
                    <div className={cn('flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5', isToday ? 'bg-accent text-accent-fg' : 'text-fg-muted')}>
                      <span className="text-[11px] font-semibold uppercase">{weekday.format(day).replace('.', '')}</span>
                      <span className="text-xl leading-tight font-bold tabular-nums">{day.getDate()}</span>
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 self-center">
                      {holidayOn(calendar, isoDate(day)) && <p className="text-sm font-semibold text-danger-text">{t('shifts.holiday', { name: holidayOn(calendar, isoDate(day))!.name })}</p>}
                      {absenceOn(calendar, me.id, isoDate(day)) && <AbsenceTag type={absenceOn(calendar, me.id, isoDate(day))!.type} pending={absenceOn(calendar, me.id, isoDate(day))!.status === 'PENDING'} />}
                      {list.length === 0 && !holidayOn(calendar, isoDate(day)) && !absenceOn(calendar, me.id, isoDate(day)) && <p className="text-sm text-fg-subtle">{t('shifts.free')}</p>}
                      {list.map((s) => (
                        <ShiftCard key={s.id} shift={s} onClick={personal ? () => setDraft({ shift: s, userId: me.id, date: day }) : undefined} />
                      ))}
                    </div>
                    {personal && (
                      <button
                        type="button"
                        onClick={() => setDraft({ userId: me.id, date: day })}
                        aria-label={t('shifts.addOn', { day: weekday.format(day) })}
                        className="focus-ring flex size-10 shrink-0 items-center justify-center self-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg"
                      >
                        <Plus className="size-5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      <ShiftSheet draft={draft} onClose={() => setDraft(null)} people={[{ id: me.id, fullName: me.fullName }]} />
    </div>
  );
}

// ── Cuadrante del responsable ────────────────────────────────────────────

/** Etiqueta de una ausencia en el cuadrante o la agenda (con borde discontinuo si está pendiente). */
function AbsenceTag({ type, pending }: { type: AbsenceTypeId; pending: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold', ABSENCE_TONE[type], pending && 'border border-dashed border-current')}>
      {t(`absences.type.${type}`)}
      {pending && ` · ${t('absences.status.PENDING').toLowerCase()}`}
    </span>
  );
}

function Chip({ shift, onClick }: { shift: ShiftDto; onClick: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const color = shift.locationColor ?? 'var(--accent)';
  return (
    <button
      type="button"
      onClick={onClick}
      title={shift.published ? undefined : t('shifts.draft')}
      className={cn(
        'focus-ring block w-full rounded-lg px-2 py-1.5 text-left text-xs leading-tight transition-transform hover:-translate-y-px',
        // Borrador: borde discontinuo y sin relleno, para distinguirlo de un vistazo.
        shift.published ? 'text-white' : 'border-2 border-dashed bg-surface text-fg',
      )}
      style={shift.published ? { backgroundColor: color } : { borderColor: color }}
    >
      <span className="block font-bold tabular-nums">
        {formatTime(shift.plannedStart, lang)}–{formatTime(shift.plannedEnd, lang)}
      </span>
      {shift.locationName && <span className="block truncate opacity-90">{shift.locationName}</span>}
    </button>
  );
}

function Planner() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [monday, setMonday] = useState(() => startOfWeek(new Date()));
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => (new Date().getDay() + 6) % 7);
  const [draft, setDraft] = useState<ShiftDraft | null>(null);

  const members = useQuery({ queryKey: ['members', workspaceId], queryFn: () => api<MemberDto[]>('/members') });
  const people: PersonRef[] = useMemo(
    () => (members.data ?? []).filter((m) => m.active && m.role !== 'INSPECTOR').map((m) => ({ id: m.userId, fullName: m.fullName })),
    [members.data],
  );

  // En vista de mes se cargan las semanas completas que muestra la cuadrícula.
  const gridStart = startOfWeek(month);
  const [from, to] = view === 'week' ? [monday, addDays(monday, 7)] : [gridStart, addDays(gridStart, 42)];
  const shifts = useShifts(from, to);
  const calendar = useCalendar(from, to).data;
  const list = shifts.data ?? [];
  const drafts = list.filter((s) => !s.published).length;
  const today = new Date();

  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: ['shifts'] });
  const publish = useMutation({
    mutationFn: () => api<{ published: number }>('/shifts/publish', { method: 'POST', body: { from: from.toISOString(), to: to.toISOString() } }),
    onSuccess: (r) => {
      refresh();
      toast.success(t('shifts.published', { count: r.published }));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const copy = useMutation({
    mutationFn: () =>
      api<{ copied: number; skipped: number }>('/shifts/copy', {
        method: 'POST',
        body: { from: addDays(monday, -7).toISOString(), to: monday.toISOString(), offsetDays: 7 },
      }),
    onSuccess: (r) => {
      refresh();
      if (r.copied === 0) toast.info(t(r.skipped ? 'shifts.copyNothingNew' : 'shifts.copyEmpty'));
      else toast.success(t('shifts.copied', { count: r.copied }));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  const weekday = new Intl.DateTimeFormat(lang, { weekday: 'short' });
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
  const cell = (userId: string, day: Date): ShiftDto[] => onDay(list, day).filter((s) => s.user.id === userId);
  const addButton = (userId: string, day: Date, label: string, className: string) => (
    <button type="button" onClick={() => setDraft({ userId, date: day })} aria-label={label} className={cn('focus-ring flex items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg', className)}>
      <Plus className="size-4" />
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          className="w-44"
          label={t('shifts.view')}
          value={view}
          onChange={setView}
          options={[
            { value: 'week', label: t('hours.week') },
            { value: 'month', label: t('hours.month') },
          ]}
        />
        <div className="ml-auto flex gap-2">
          {view === 'week' && (
            <Button variant="secondary" loading={copy.isPending} onClick={() => copy.mutate()} icon={<Copy className="size-4" />}>
              <span className="max-sm:hidden">{t('shifts.copyPrev')}</span>
              <span className="sm:hidden">{t('shifts.copyShort')}</span>
            </Button>
          )}
          <Button disabled={drafts === 0} loading={publish.isPending} onClick={() => publish.mutate()} icon={<Send className="size-4" />}>
            {drafts > 0 ? t('shifts.publish', { count: drafts }) : t('shifts.allPublished')}
          </Button>
        </div>
      </div>

      {view === 'week' ? (
        <PeriodNav
          label={weekLabel(monday, lang)}
          onPrev={() => setMonday(addDays(monday, -7))}
          onNext={() => setMonday(addDays(monday, 7))}
          onToday={() => setMonday(startOfWeek(new Date()))}
          isCurrent={sameDay(monday, startOfWeek(new Date()))}
        />
      ) : (
        <PeriodNav
          label={new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(month)}
          onPrev={() => setMonth(addMonths(month, -1))}
          onNext={() => setMonth(addMonths(month, 1))}
          onToday={() => setMonth(startOfMonth(new Date()))}
          isCurrent={sameDay(month, startOfMonth(new Date()))}
        />
      )}

      {members.isPending || shifts.isPending ? (
        <Card className="flex justify-center py-20 text-fg-subtle">
          <Spinner className="size-6" />
        </Card>
      ) : view === 'month' ? (
        <Card className="overflow-hidden p-2">
          <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-fg-subtle uppercase">
            {days.map((d) => (
              <div key={d.getTime()} className="py-1.5">
                {weekday.format(d).replace('.', '')}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((day) => {
              const dayShifts = onDay(list, day);
              const inMonth = day.getMonth() === month.getMonth();
              const hasDraft = dayShifts.some((s) => !s.published);
              return (
                <button
                  key={day.getTime()}
                  type="button"
                  onClick={() => {
                    setMonday(startOfWeek(day));
                    setSelectedDay((day.getDay() + 6) % 7);
                    setView('week');
                  }}
                  aria-label={`${new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' }).format(day)}: ${t('shifts.count', { count: dayShifts.length })}`}
                  className={cn(
                    'focus-ring flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl text-sm transition-colors hover:bg-surface-2 sm:aspect-[4/3]',
                    !inMonth && 'opacity-35',
                    sameDay(day, today) && 'bg-accent-soft font-bold text-accent-text',
                  )}
                >
                  <span className={cn('tabular-nums', holidayOn(calendar, isoDate(day)) && 'font-bold text-danger-text')} title={holidayOn(calendar, isoDate(day))?.name}>
                    {day.getDate()}
                  </span>
                  {dayShifts.length > 0 ? (
                    <span
                      className={cn(
                        'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums',
                        hasDraft ? 'border-2 border-dashed border-accent text-accent-text' : 'bg-accent text-accent-fg',
                      )}
                    >
                      {dayShifts.length}
                    </span>
                  ) : (
                    <span className="h-5" />
                  )}
                </button>
              );
            })}
          </div>
          <p className="edge-t mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-2 pt-2.5 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-accent" />
              {t('shifts.legendPublished')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full border-2 border-dashed border-accent" />
              {t('shifts.legendDraft')}
            </span>
          </p>
        </Card>
      ) : (
        <>
          {/* Escritorio: cuadrícula persona × día. */}
          <Card className="hidden overflow-x-auto lg:block">
            <table className="w-full table-fixed border-collapse">
              <thead>
                <tr>
                  <th className="w-44 px-3 py-2 text-left text-xs font-semibold text-fg-subtle uppercase">{t('shifts.person')}</th>
                  {days.map((d) => {
                    const h = holidayOn(calendar, isoDate(d));
                    return (
                      <th key={d.getTime()} className={cn('edge-b px-1 py-2 text-center text-xs font-semibold uppercase', sameDay(d, today) ? 'text-accent-text' : 'text-fg-subtle', h && 'bg-danger-soft/50')}>
                        {weekday.format(d).replace('.', '')} <span className="text-sm tabular-nums">{d.getDate()}</span>
                        {h && <span className="block truncate text-[10px] font-semibold tracking-normal text-danger-text normal-case" title={h.name}>{h.name}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const planned = list.filter((s) => s.user.id === p.id).reduce((sum, s) => sum + netSeconds(s), 0);
                  return (
                    <tr key={p.id} className="edge-t">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <span className="flex items-center gap-2">
                          <Avatar name={p.fullName} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{p.fullName}</span>
                            <span className="block text-xs text-fg-muted tabular-nums">{formatHours(planned, lang)}</span>
                          </span>
                        </span>
                      </th>
                      {days.map((d) => (
                        <td key={d.getTime()} className={cn('group h-16 border-l border-border p-1 align-top', sameDay(d, today) && 'bg-accent-soft/40', holidayOn(calendar, isoDate(d)) && 'bg-danger-soft/30')}>
                          <div className="flex h-full flex-col gap-1">
                            {absenceOn(calendar, p.id, isoDate(d)) && <AbsenceTag type={absenceOn(calendar, p.id, isoDate(d))!.type} pending={absenceOn(calendar, p.id, isoDate(d))!.status === 'PENDING'} />}
                            {cell(p.id, d).map((s) => (
                              <Chip key={s.id} shift={s} onClick={() => setDraft({ shift: s, userId: p.id, date: d })} />
                            ))}
                            {addButton(p.id, d, t('shifts.addFor', { name: p.fullName, day: d.getDate() }), 'min-h-6 flex-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Móvil: tira de días y lista de personas del día elegido. */}
          <div className="space-y-3 lg:hidden">
            <div role="tablist" aria-label={t('shifts.day')} className="grid grid-cols-7 gap-1.5">
              {days.map((d, i) => {
                const active = i === selectedDay;
                const count = onDay(list, d).length;
                return (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedDay(i)}
                    className={cn(
                      'focus-ring flex flex-col items-center rounded-2xl py-2 transition-colors',
                      active ? 'bg-accent text-accent-fg' : 'edge bg-surface text-fg-muted',
                      !active && sameDay(d, today) && 'border-accent text-accent-text',
                    )}
                  >
                    <span className="text-[11px] font-semibold uppercase">{weekday.format(d).replace('.', '')}</span>
                    <span className="text-lg leading-tight font-bold tabular-nums">{d.getDate()}</span>
                    <span className={cn('mt-0.5 size-1.5 rounded-full', count ? (active ? 'bg-white' : 'bg-accent') : 'bg-transparent')} />
                  </button>
                );
              })}
            </div>
            <Card className="overflow-hidden">
              <ul>
                {people.map((p, i) => {
                  const day = days[selectedDay]!;
                  return (
                    <li key={p.id} className={cn('flex items-center gap-3 px-3 py-2.5', i > 0 && 'edge-t')}>
                      <Avatar name={p.fullName} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{p.fullName}</p>
                        {absenceOn(calendar, p.id, isoDate(day)) && <AbsenceTag type={absenceOn(calendar, p.id, isoDate(day))!.type} pending={absenceOn(calendar, p.id, isoDate(day))!.status === 'PENDING'} />}
                        <div className="mt-1 grid grid-cols-2 gap-1.5 empty:hidden">
                          {cell(p.id, day).map((s) => (
                            <Chip key={s.id} shift={s} onClick={() => setDraft({ shift: s, userId: p.id, date: day })} />
                          ))}
                        </div>
                        {cell(p.id, day).length === 0 && !absenceOn(calendar, p.id, isoDate(day)) && <p className="text-sm text-fg-subtle">{t('shifts.free')}</p>}
                      </div>
                      {addButton(p.id, day, t('shifts.addFor', { name: p.fullName, day: day.getDate() }), 'edge size-10 shrink-0 !rounded-full')}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </>
      )}

      <ShiftSheet draft={draft} onClose={() => setDraft(null)} people={people} calendar={calendar} />
    </div>
  );
}

export function Schedule() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const plans = ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');
  const [tab, setTab] = useState<'planner' | 'mine'>('planner');
  const [patterns, setPatterns] = useState(false);

  return (
    <div className={cn('animate-page', plans && tab === 'planner' && 'lg:-mx-8 xl:-mx-24')}>
      <PageHeader
        title={t('nav.schedule')}
        subtitle={ws.kind === 'organization' ? ws.name : undefined}
        action={
          plans && (
            <Button variant="secondary" onClick={() => setPatterns(true)} icon={<Repeat className="size-4" />}>
              {t('shifts.patterns')}
            </Button>
          )
        }
      />
      {plans && <PatternsSheet open={patterns} onClose={() => setPatterns(false)} />}
      {plans && (
        <Segmented
          className="mb-4 max-w-sm"
          label={t('nav.schedule')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'planner', label: t('shifts.planner'), icon: <CalendarDays /> },
            { value: 'mine', label: t('shifts.mine') },
          ]}
        />
      )}
      {plans && tab === 'planner' ? <Planner /> : <MySchedule />}
    </div>
  );
}
