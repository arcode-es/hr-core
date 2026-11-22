import type { ApplyPatternResult, LocationDto, MemberDto, PatternDay, ShiftPatternDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Minus, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';
import { selectClass } from '../ui/Switch';

type Day = NonNullable<PatternDay>;
const WORK: Day = { start: '07:00', end: '15:00', breakMinutes: 30, locationId: null };

/** Resumen de un ciclo: «M M N –» con la hora de inicio de cada día. */
const summary = (days: PatternDay[]): string => days.map((d) => (d ? d.start : '–')).join(' · ');

const nextMonday = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Turnos rotativos: los patrones de la empresa, crear uno nuevo y aplicarlo a varias personas. */
export function PatternsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'apply'; pattern: ShiftPatternDto }>({ kind: 'list' });
  const patterns = useQuery({ queryKey: ['shift-patterns', workspaceId], queryFn: () => api<ShiftPatternDto[]>('/shift-patterns'), enabled: open });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/shift-patterns/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['shift-patterns'] }),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const close = (): void => {
    onClose();
    setTimeout(() => setView({ kind: 'list' }), 300);
  };
  const title = view.kind === 'apply' ? t('shifts.applyTitle', { name: view.pattern.name }) : view.kind === 'new' ? t('shifts.newPattern') : t('shifts.patterns');

  return (
    <Sheet open={open} onClose={close} title={title} description={view.kind === 'list' ? t('shifts.patternsDesc') : t('shifts.patternsHint')} className="sm:max-w-lg">
      <div className="space-y-4 pt-1">
        {view.kind !== 'list' && (
          <Button variant="ghost" size="sm" onClick={() => setView({ kind: 'list' })} icon={<ArrowLeft className="size-4" />}>
            {t('shifts.patterns')}
          </Button>
        )}
        {view.kind === 'list' && (
          <>
            {(patterns.data ?? []).length === 0 ? (
              <p className="py-3 text-center text-sm text-fg-muted">{t('shifts.noPatterns')}</p>
            ) : (
              <ul className="edge divide-y divide-border rounded-2xl">
                {(patterns.data ?? []).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-fg-muted tabular-nums">{summary(p.days)}</span>
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => setView({ kind: 'apply', pattern: p })} icon={<Repeat className="size-4" />}>
                      {t('shifts.apply')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${t('common.delete')}: ${p.name}`}
                      onClick={() => window.confirm(t('shifts.deletePatternConfirm', { name: p.name })) && remove.mutate(p.id)}
                      icon={<Trash2 className="size-4" />}
                    />
                  </li>
                ))}
              </ul>
            )}
            <Button block variant="secondary" onClick={() => setView({ kind: 'new' })} icon={<Plus className="size-4" />}>
              {t('shifts.newPattern')}
            </Button>
          </>
        )}
        {view.kind === 'new' && <NewPattern onDone={() => setView({ kind: 'list' })} />}
        {view.kind === 'apply' && <ApplyPattern pattern={view.pattern} onDone={close} />}
      </div>
    </Sheet>
  );
}

function NewPattern({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const [name, setName] = useState('');
  const [days, setDays] = useState<PatternDay[]>([WORK, WORK, null, null]);
  const locations = useQuery({ queryKey: ['locations', workspaceId], queryFn: () => api<LocationDto[]>('/locations') });
  const save = useMutation({
    mutationFn: () => api<ShiftPatternDto>('/shift-patterns', { method: 'POST', body: { name: name.trim(), days } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shift-patterns'] });
      toast.success(t('shifts.patternSaved'));
      onDone();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const set = (i: number, d: PatternDay): void => setDays((prev) => prev.map((x, j) => (j === i ? d : x)));
  return (
    <div className="space-y-4">
      <Field label={t('shifts.patternName')} placeholder={t('shifts.patternNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      <ol className="space-y-2">
        {days.map((d, i) => (
          <li key={i} className={cn('edge rounded-2xl p-3', !d && 'bg-surface-2/50')}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{t('shifts.cycleDay', { n: i + 1 })}</span>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={!d} onChange={(e) => set(i, e.target.checked ? null : WORK)} className="size-5 accent-(--accent)" />
                {t('shifts.dayOff')}
              </label>
            </div>
            {d && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Field label={t('manual.start')} type="time" value={d.start} onChange={(e) => set(i, { ...d, start: e.target.value })} />
                <Field label={t('manual.end')} type="time" value={d.end} onChange={(e) => set(i, { ...d, end: e.target.value })} />
                <Field label={t('shifts.breakMinutes')} type="number" min={0} max={480} inputMode="numeric" value={String(d.breakMinutes)} onChange={(e) => set(i, { ...d, breakMinutes: Number(e.target.value) || 0 })} />
                <div className="col-span-3">
                  <label htmlFor={`pattern-loc-${i}`} className="sr-only">
                    {t('manual.location')}
                  </label>
                  <select id={`pattern-loc-${i}`} className={cn(selectClass, 'h-11')} value={d.locationId ?? ''} onChange={(e) => set(i, { ...d, locationId: e.target.value || null })}>
                    <option value="">{t('manual.noLocation')}</option>
                    {(locations.data ?? []).filter((l) => l.isActive).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={days.length >= 28} onClick={() => setDays([...days, WORK])} icon={<Plus className="size-4" />}>
          {t('shifts.addDay')}
        </Button>
        <Button variant="ghost" size="sm" disabled={days.length <= 1} onClick={() => setDays(days.slice(0, -1))} icon={<Minus className="size-4" />}>
          {t('shifts.removeDay')}
        </Button>
      </div>
      <Button size="lg" block loading={save.isPending} disabled={name.trim().length < 2 || days.every((d) => !d)} onClick={() => save.mutate()}>
        {t('shifts.savePattern')}
      </Button>
    </div>
  );
}

function ApplyPattern({ pattern, onDone }: { pattern: ShiftPatternDto; onDone: () => void }) {
  const { t } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const members = useQuery({ queryKey: ['members', workspaceId], queryFn: () => api<MemberDto[]>('/members') });
  const people = (members.data ?? []).filter((m) => m.active && m.role !== 'INSPECTOR');
  const [chosen, setChosen] = useState<string[]>([]);
  const [start, setStart] = useState(nextMonday);
  const [weeks, setWeeks] = useState('4');
  const [stagger, setStagger] = useState('0');
  const apply = useMutation({
    mutationFn: () =>
      api<ApplyPatternResult>(`/shift-patterns/${pattern.id}/apply`, {
        method: 'POST',
        body: { userIds: chosen, startDate: start, weeks: Number(weeks), stagger: Number(stagger) },
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success(t('shifts.applied', { created: r.created, skipped: r.skipped.holiday + r.skipped.absence + r.skipped.overlap }));
      onDone();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const toggle = (id: string): void => setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-sm font-medium">{t('shifts.applyPeople')}</p>
        <ul className="edge max-h-56 divide-y divide-border overflow-y-auto rounded-2xl">
          {people.map((p) => {
            const on = chosen.includes(p.userId);
            const order = chosen.indexOf(p.userId);
            return (
              <li key={p.userId}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(p.userId)}
                  className={cn('focus-ring flex w-full items-center gap-3 px-3 py-2.5 text-left', on ? 'bg-accent-soft' : 'hover:bg-surface-2')}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.fullName}</span>
                  {on && Number(stagger) > 0 && <span className="text-xs text-fg-muted tabular-nums">+{order * Number(stagger)}</span>}
                  <span className={cn('flex size-6 items-center justify-center rounded-md border-2', on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong')}>
                    {on && <Check className="size-4" strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('shifts.applyStart')} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Field label={t('shifts.applyWeeks')} type="number" min={1} max={26} inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} />
      </div>
      <Field
        label={t('shifts.applyStagger')}
        hint={t('shifts.applyStaggerHint')}
        type="number"
        min={0}
        max={27}
        inputMode="numeric"
        value={stagger}
        onChange={(e) => setStagger(e.target.value)}
      />
      <Button size="lg" block loading={apply.isPending} disabled={!chosen.length || !start || !(Number(weeks) >= 1)} onClick={() => apply.mutate()} icon={<Repeat className="size-5" />}>
        {t('shifts.applySubmit')}
      </Button>
    </div>
  );
}
