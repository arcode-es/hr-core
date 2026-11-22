import { HANDOVER_NOTE_MAX, type ClockStatus, type HandoverNoteDto, type PersonRef, type SentHandoverNoteDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, CheckCheck, Clock3, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { clockKey, type ClockView } from '../lib/clock';
import { errorMessage } from '../lib/errors';
import { formatDay, formatTime } from '../lib/format';
import { queryClient } from '../lib/query';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';

export interface HandoverDraft {
  text: string;
  /** '' = quien empiece el siguiente turno. */
  recipientId: string;
}
export const EMPTY_HANDOVER: HandoverDraft = { text: '', recipientId: '' };

const fieldClass =
  'edge w-full rounded-control bg-surface px-3.5 text-base text-fg placeholder:text-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none';

const when = (iso: string, locale: string): string => `${formatDay(iso, locale)} · ${formatTime(iso, locale)}`;

/** Notas de relevo recibidas al iniciar la jornada: se quedan a la vista hasta que se marcan como leídas. */
export function HandoverNotes({ notes }: { notes: HandoverNoteDto[] | undefined }) {
  const { t, i18n } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const read = useMutation({
    mutationFn: (id: string) => api<ClockStatus>(`/time/notes/${id}/read`, { method: 'POST' }),
    onSuccess: (status) =>
      queryClient.setQueryData<ClockView>(clockKey(workspaceId), (prev) => (prev ? { ...prev, notes: status.notes } : prev)),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  if (!notes?.length) return null;
  return (
    <section aria-labelledby="handover-title" className="space-y-2.5">
      <SectionTitle id="handover-title">{t('handover.received')}</SectionTitle>
      {notes.map((n) => (
        <Card key={n.id} className="border-accent/40 p-4 shadow-glow" data-testid="handover-note">
          <div className="flex items-center gap-3">
            <Avatar name={n.author.fullName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{n.author.fullName}</p>
              <p className="truncate text-sm text-fg-muted">
                {when(n.createdAt, i18n.language)}
                {n.locationName ? ` · ${n.locationName}` : ''}
              </p>
            </div>
            <span className="rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[11px] tracking-wide text-accent-text uppercase">
              {t(n.direct ? 'handover.forYou' : 'handover.forShift')}
            </span>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap">{n.text}</p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="secondary" loading={read.isPending && read.variables === n.id} onClick={() => read.mutate(n.id)} icon={<Check className="size-4" />}>
              {t('handover.markRead')}
            </Button>
          </div>
        </Card>
      ))}
    </section>
  );
}

/** Campo para dejar la nota al terminar la jornada, con su destinatario. */
export function HandoverComposer({ value, onChange }: { value: HandoverDraft; onChange: (v: HandoverDraft) => void }) {
  const { t } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const { data: colleagues } = useQuery({ queryKey: ['colleagues', workspaceId], queryFn: () => api<PersonRef[]>('/time/colleagues'), staleTime: 300_000 });
  return (
    <div className="mb-4 space-y-2">
      <label htmlFor="handover-text" className="flex items-center gap-2 text-sm font-medium">
        <MessageSquareText className="size-4 text-accent-text" aria-hidden="true" />
        {t('handover.label')}
        <span className="font-normal text-fg-subtle">{t('handover.optional')}</span>
      </label>
      <textarea
        id="handover-text"
        rows={3}
        maxLength={HANDOVER_NOTE_MAX}
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder={t('handover.placeholder')}
        className={`${fieldClass} py-3`}
      />
      {value.text.trim() !== '' && (
        <div>
          <label htmlFor="handover-to" className="mb-1.5 block text-sm font-medium">
            {t('handover.to')}
          </label>
          <select id="handover-to" value={value.recipientId} onChange={(e) => onChange({ ...value, recipientId: e.target.value })} className={`${fieldClass} h-12`}>
            <option value="">{t('handover.nextShift')}</option>
            {(colleagues ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-fg-muted">{t(value.recipientId ? 'handover.hintPerson' : 'handover.hintShift')}</p>
        </div>
      )}
    </div>
  );
}

/** Las notas que ha dejado esta persona y si ya han llegado. */
export function SentHandoverNotes() {
  const { t, i18n } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const { data } = useQuery({ queryKey: ['handover-sent', workspaceId], queryFn: () => api<SentHandoverNoteDto[]>('/time/notes/sent') });
  if (!data?.length) return null;
  return (
    <section aria-labelledby="handover-sent-title" className="pt-2">
      <SectionTitle id="handover-sent-title" className="mb-2.5">
        {t('handover.sent')}
      </SectionTitle>
      <Card className="divide-y divide-border">
        {data.map((n) => {
          const Icon = n.readAt ? CheckCheck : n.deliveredAt ? Check : Clock3;
          return (
            <div key={n.id} className="p-4">
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{n.text}</p>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-fg-muted">
                <Icon className={n.readAt ? 'size-4 text-success-text' : 'size-4'} aria-hidden="true" />
                <span>
                  {when(n.createdAt, i18n.language)} ·{' '}
                  {n.deliveredTo
                    ? t(n.readAt ? 'handover.readBy' : 'handover.deliveredTo', { name: n.deliveredTo.fullName })
                    : n.recipient
                      ? t('handover.waitingPerson', { name: n.recipient.fullName })
                      : t('handover.waitingShift')}
                </span>
              </p>
            </div>
          );
        })}
      </Card>
    </section>
  );
}
