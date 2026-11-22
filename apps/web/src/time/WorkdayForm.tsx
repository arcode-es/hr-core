import type { LocationDto, ManualWorkdayInput, PauseKind, PersonRef, WorkdayDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Info, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDuration } from '../lib/format';
import { queryClient } from '../lib/query';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';

interface BreakRow {
  key: number;
  kind: PauseKind;
  start: string;
  end: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Hora local «HH:mm» de la jornada → instante. Las horas anteriores al inicio
 * se entienden del día siguiente, así un turno de noche se escribe tal cual.
 */
function toInstant(date: string, time: string, startTime: string): Date {
  const d = new Date(`${date}T${time}:00`);
  if (time < startTime) d.setDate(d.getDate() + 1);
  return d;
}

const selectClass =
  'edge h-12 w-full rounded-control bg-surface px-3 text-base text-fg focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Jornada a corregir; sin ella se crea una nueva. */
  workday?: WorkdayDto | null;
  /** Responsable registrando la jornada de otra persona. */
  forUser?: PersonRef | null;
}

export function WorkdayFormSheet({ open, onClose, workday, forUser }: Props) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={workday ? t('manual.correctTitle') : t('manual.newTitle')}
      description={forUser ? t('manual.forUser', { name: forUser.fullName }) : undefined}
      className="sm:max-w-lg"
    >
      {/* key: el formulario se reinicia cada vez que se abre para otra jornada. */}
      {open && <WorkdayForm key={workday?.id ?? forUser?.id ?? 'new'} onClose={onClose} workday={workday ?? null} forUser={forUser ?? null} />}
    </Sheet>
  );
}

function WorkdayForm({ onClose, workday, forUser }: { onClose: () => void; workday: WorkdayDto | null; forUser: PersonRef | null }) {
  const { t } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const ws = useWorkspace();
  const needsReview = ws.kind === 'organization' && ws.role === 'EMPLOYEE';

  const initialStart = workday ? new Date(workday.startedAt) : null;
  const [date, setDate] = useState(initialStart ? localDate(initialStart) : localDate(new Date(Date.now() - 86_400_000)));
  const [start, setStart] = useState(initialStart ? localTime(initialStart) : '08:00');
  const [end, setEnd] = useState(workday?.endedAt ? localTime(new Date(workday.endedAt)) : '16:00');
  const [breaks, setBreaks] = useState<BreakRow[]>(() =>
    (workday?.segments ?? [])
      .filter((s) => s.entryType !== 'WORK' && s.endTime)
      .map((s, i) => ({
        key: i,
        kind: s.entryType === 'TRAVEL' ? 'TRAVEL' : s.breakKind === 'MEAL' ? 'MEAL' : 'REST',
        start: localTime(new Date(s.startTime)),
        end: localTime(new Date(s.endTime!)),
      })),
  );
  const [locationId, setLocationId] = useState(workday?.locationId ?? '');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);

  const locations = useQuery({ queryKey: ['locations', workspaceId], queryFn: () => api<LocationDto[]>('/locations') });

  const startAt = toInstant(date, start, start);
  const endAt = toInstant(date, end, start);
  // Fin igual al inicio: jornada de 24 h que termina al día siguiente.
  if (end === start) endAt.setDate(endAt.getDate() + 1);
  const overnight = end <= start;
  const breakSeconds = breaks.reduce((sum, b) => {
    const s = toInstant(date, b.start, start).getTime();
    const e = toInstant(date, b.end, start).getTime();
    return sum + Math.max(0, (e - s) / 1000);
  }, 0);
  const worked = Math.max(0, (endAt.getTime() - startAt.getTime()) / 1000 - breakSeconds);

  const save = useMutation({
    mutationFn: () => {
      const body: ManualWorkdayInput = {
        ...(forUser && !workday ? { userId: forUser.id } : {}),
        start: startAt.toISOString(),
        end: endAt.toISOString(),
        breaks: breaks.map((b) => ({
          kind: b.kind,
          start: toInstant(date, b.start, start).toISOString(),
          end: toInstant(date, b.end, start).toISOString(),
        })),
        locationId: locationId || null,
        reason: reason.trim(),
      };
      return api<WorkdayDto>(workday ? `/time/workdays/${workday.id}/correct` : '/time/manual', { method: 'POST', body });
    },
    onSuccess: (saved) => {
      for (const key of ['workdays', 'review', 'team-day', 'audit']) void queryClient.invalidateQueries({ queryKey: [key] });
      toast.success(saved.approvalStatus === 'PENDING' ? t('manual.sentForReview') : t('manual.saved'));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setReasonError(true);
      return;
    }
    save.mutate();
  };

  const updateBreak = (key: number, patch: Partial<BreakRow>): void =>
    setBreaks((list) => list.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  return (
    <form onSubmit={submit} noValidate className="space-y-4 pt-1">
      <Field label={t('manual.date')} type="date" value={date} max={localDate(new Date())} onChange={(e) => setDate(e.target.value)} required />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('manual.start')} type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        <Field
          label={t('manual.end')}
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          hint={overnight ? t('manual.nextDay') : undefined}
          required
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('manual.breaks')}</legend>
        <div className="space-y-2">
          {breaks.map((b) => (
            <div key={b.key} className="edge grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-surface-2/50 p-2.5">
              <select
                aria-label={t('manual.breakKind')}
                value={b.kind}
                onChange={(e) => updateBreak(b.key, { kind: e.target.value as PauseKind })}
                className={selectClass}
              >
                {(['MEAL', 'REST', 'TRAVEL'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`clock.kind_${k}`)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setBreaks((list) => list.filter((x) => x.key !== b.key))}
                aria-label={t('manual.removeBreak')}
                className="focus-ring flex size-12 items-center justify-center rounded-control text-fg-muted hover:bg-surface-2 hover:text-danger-text"
              >
                <Trash2 className="size-5" />
              </button>
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <input
                  type="time"
                  aria-label={t('manual.breakStart')}
                  value={b.start}
                  onChange={(e) => updateBreak(b.key, { start: e.target.value })}
                  className={selectClass}
                />
                <input
                  type="time"
                  aria-label={t('manual.breakEnd')}
                  value={b.end}
                  onChange={(e) => updateBreak(b.key, { end: e.target.value })}
                  className={selectClass}
                />
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            block
            icon={<Plus className="size-4" />}
            onClick={() => setBreaks((list) => [...list, { key: Date.now(), kind: 'MEAL', start: '13:00', end: '14:00' }])}
          >
            {t('manual.addBreak')}
          </Button>
        </div>
      </fieldset>

      {(locations.data?.length ?? 0) > 0 && (
        <div>
          <label htmlFor="wd-location" className="mb-1.5 block text-sm font-medium">
            {t('manual.location')}
          </label>
          <select id="wd-location" value={locationId} onChange={(e) => setLocationId(e.target.value)} className={selectClass}>
            <option value="">{t('manual.noLocation')}</option>
            {locations.data!
              .filter((l) => l.isActive || l.id === locationId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="wd-reason" className="mb-1.5 block text-sm font-medium">
          {t('manual.reason')}
        </label>
        <textarea
          id="wd-reason"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonError(false);
          }}
          placeholder={t(workday ? 'manual.reasonPlaceholderCorrect' : 'manual.reasonPlaceholderNew')}
          aria-invalid={reasonError || undefined}
          className="edge w-full rounded-control bg-surface px-3.5 py-3 text-base placeholder:text-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none aria-invalid:border-danger"
        />
        <p className={reasonError ? 'mt-1 text-sm font-medium text-danger-text' : 'mt-1 text-sm text-fg-muted'} role={reasonError ? 'alert' : undefined}>
          {t('manual.reasonHint')}
        </p>
      </div>

      <div className="edge flex items-center justify-between rounded-2xl bg-surface-2/60 px-4 py-3">
        <span className="text-sm font-medium text-fg-muted">{t('manual.total')}</span>
        <span className="text-lg font-bold tabular-nums">{formatDuration(worked)}</span>
      </div>

      {needsReview && !forUser && (
        <p className="flex gap-2.5 rounded-2xl bg-accent-soft px-4 py-3 text-sm font-medium text-accent-text">
          <Info className="mt-0.5 size-4 shrink-0" />
          {t('manual.reviewNotice')}
        </p>
      )}

      <Button type="submit" size="lg" block loading={save.isPending}>
        {needsReview && !forUser ? t('manual.submitForReview') : workday ? t('manual.saveCorrection') : t('manual.save')}
      </Button>
    </form>
  );
}
