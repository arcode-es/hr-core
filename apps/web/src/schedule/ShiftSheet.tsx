import type { LocationDto, PersonRef, ShiftDto, TeamCalendar } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { addDays, atTime, clockTime, isoDate, startOfWeek } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { formatDuration } from '../lib/format';
import { queryClient } from '../lib/query';
import { useSession } from '../stores/session';
import { absenceOn, holidayOn } from './calendar';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';

const selectClass =
  'edge h-12 w-full rounded-control bg-surface px-3 text-base text-fg focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none';
const BREAKS = [0, 15, 30, 45, 60, 90, 120];

export interface ShiftDraft {
  /** Turno existente a editar; sin él se crea uno nuevo. */
  shift?: ShiftDto;
  userId: string;
  date: Date;
}

interface Props {
  draft: ShiftDraft | null;
  onClose: () => void;
  /** Personas a las que se puede asignar; una sola en el espacio personal. */
  people: PersonRef[];
  /** Festivos y ausencias del periodo, para avisar al planificar sobre ellos. */
  calendar?: TeamCalendar;
}

export function ShiftSheet({ draft, onClose, people, calendar }: Props) {
  const { t } = useTranslation();
  return (
    <Sheet open={!!draft} onClose={onClose} title={draft?.shift ? t('shifts.editTitle') : t('shifts.newTitle')} className="sm:max-w-lg">
      {draft && <ShiftForm key={draft.shift?.id ?? `${draft.userId}-${draft.date.getTime()}`} draft={draft} onClose={onClose} people={people} calendar={calendar} />}
    </Sheet>
  );
}

function ShiftForm({ draft, onClose, people, calendar }: { draft: ShiftDraft; onClose: () => void; people: PersonRef[]; calendar?: TeamCalendar }) {
  const { t, i18n } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const editing = draft.shift;

  const [userId, setUserId] = useState(draft.userId);
  const [date, setDate] = useState(isoDate(editing ? new Date(editing.plannedStart) : draft.date));
  const [start, setStart] = useState(editing ? clockTime(new Date(editing.plannedStart)) : '08:00');
  const [end, setEnd] = useState(editing ? clockTime(new Date(editing.plannedEnd)) : '16:00');
  const [breakMinutes, setBreakMinutes] = useState(editing?.breakMinutes ?? 30);
  const [locationId, setLocationId] = useState(editing?.locationId ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  // Días de la semana (0 = lunes) en los que se repite el turno al crearlo.
  const monday = startOfWeek(atTime(date, '12:00'));
  const weekday = (atTime(date, '12:00').getDay() + 6) % 7;
  const [repeat, setRepeat] = useState<Set<number>>(() => new Set([weekday]));

  const locations = useQuery({ queryKey: ['locations', workspaceId], queryFn: () => api<LocationDto[]>('/locations') });

  const overnight = end <= start;
  const span = (day: Date): { start: string; end: string } => {
    const d = isoDate(day);
    const to = atTime(d, end);
    if (overnight) to.setDate(to.getDate() + 1);
    return { start: atTime(d, start).toISOString(), end: to.toISOString() };
  };
  const sample = span(atTime(date, '12:00'));
  const net = Math.max(0, (Date.parse(sample.end) - Date.parse(sample.start)) / 1000 - breakMinutes * 60);
  const days = editing ? [atTime(date, '12:00')] : [...new Set([...repeat, weekday])].sort().map((i) => addDays(monday, i));

  const common = { breakMinutes, locationId: locationId || null, notes: notes.trim() || null };
  const done = (message: string): void => {
    void queryClient.invalidateQueries({ queryKey: ['shifts'] });
    void queryClient.invalidateQueries({ queryKey: ['hours'] });
    toast.success(message);
    onClose();
  };

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api(`/shifts/${editing.id}`, { method: 'PATCH', body: { ...span(atTime(date, '12:00')), ...common } })
        : api('/shifts', { method: 'POST', body: { shifts: days.map((d) => ({ userId, ...span(d), ...common })) } }),
    onSuccess: () => done(editing ? t('common.saved') : t('shifts.created', { count: days.length })),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/shifts/${editing!.id}`, { method: 'DELETE' }),
    onSuccess: () => done(t('shifts.deleted')),
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  // Avisos al planificar sobre un festivo o una ausencia de la persona (no lo impiden).
  const warnings = days.flatMap((d) => {
    const iso = isoDate(d);
    const label = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
    const absence = absenceOn(calendar, userId, iso);
    const holiday = holidayOn(calendar, iso, locationId || null);
    return [
      ...(absence ? [t('shifts.warnAbsence', { day: label, type: t(`absences.type.${absence.type}`), status: t(`absences.status.${absence.status}`).toLowerCase() })] : []),
      ...(holiday ? [t('shifts.warnHoliday', { day: label, name: holiday.name })] : []),
    ];
  });

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    save.mutate();
  };
  const letter = (i: number): string => new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'narrow' }).format(addDays(monday, i));

  return (
    <form onSubmit={submit} className="space-y-4 pt-1">
      {people.length > 1 && (
        <div>
          <label htmlFor="shift-user" className="mb-1.5 block text-sm font-medium">
            {t('shifts.person')}
          </label>
          <select id="shift-user" value={userId} disabled={!!editing} onChange={(e) => setUserId(e.target.value)} className={selectClass}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </div>
      )}

      <Field label={t('manual.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('manual.start')} type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        <Field label={t('manual.end')} type="time" value={end} onChange={(e) => setEnd(e.target.value)} hint={overnight ? t('manual.nextDay') : undefined} required />
      </div>

      {!editing && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-medium" id="repeat-label">
              {t('shifts.repeat')}
            </p>
            <button type="button" onClick={() => setRepeat(new Set([0, 1, 2, 3, 4]))} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">
              {t('shifts.weekdays')}
            </button>
          </div>
          <div role="group" aria-labelledby="repeat-label" className="grid grid-cols-7 gap-1.5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const on = repeat.has(i) || i === weekday;
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  aria-label={new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'long' }).format(addDays(monday, i))}
                  disabled={i === weekday}
                  onClick={() =>
                    setRepeat((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className={cn(
                    'focus-ring h-11 rounded-xl text-sm font-bold uppercase transition-colors',
                    on ? 'bg-accent text-accent-fg' : 'edge bg-surface text-fg-muted hover:bg-surface-2',
                  )}
                >
                  {letter(i)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="shift-break" className="mb-1.5 block text-sm font-medium">
            {t('shifts.break')}
          </label>
          <select id="shift-break" value={breakMinutes} onChange={(e) => setBreakMinutes(Number(e.target.value))} className={selectClass}>
            {BREAKS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? t('shifts.noBreak') : `${m} min`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="shift-location" className="mb-1.5 block text-sm font-medium">
            {t('manual.location')}
          </label>
          <select id="shift-location" value={locationId} onChange={(e) => setLocationId(e.target.value)} className={selectClass}>
            <option value="">{t('manual.noLocation')}</option>
            {(locations.data ?? [])
              .filter((l) => l.isActive || l.id === locationId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <Field label={t('shifts.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('shifts.notesPlaceholder')} maxLength={300} />

      <div className="edge flex items-center justify-between rounded-2xl bg-surface-2/60 px-4 py-3">
        <span className="text-sm font-medium text-fg-muted">{days.length > 1 ? t('shifts.totalEach', { count: days.length }) : t('shifts.total')}</span>
        <span className="text-lg font-bold tabular-nums">{formatDuration(net)}</span>
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text" role="note">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-2.5">
        {editing && (
          <Button variant="secondary" size="lg" className="text-danger-text" loading={remove.isPending} onClick={() => remove.mutate()} aria-label={t('shifts.delete')} icon={<Trash2 className="size-5" />} />
        )}
        <Button type="submit" size="lg" block loading={save.isPending}>
          {editing ? t('common.save') : t('shifts.create', { count: days.length })}
        </Button>
      </div>
    </form>
  );
}
