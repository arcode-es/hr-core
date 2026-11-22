import type { AuditEntryDto, AuditValues } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import { Ban, Check, PencilLine, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { formatTime } from '../lib/format';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';

const ICON = { CREATE_MANUAL: Plus, CREATE_CORRECTION: PencilLine, VOID: Ban, APPROVE: Check, REJECT: X } as const;
const TONE = {
  CREATE_MANUAL: 'bg-accent-soft text-accent-text',
  CREATE_CORRECTION: 'bg-accent-soft text-accent-text',
  VOID: 'bg-surface-2 text-fg-muted',
  APPROVE: 'bg-success-soft text-success-text',
  REJECT: 'bg-danger-soft text-danger-text',
} as const;

/**
 * Cada tramo tiene su propia fila de auditoría; en pantalla se agrupan las que
 * forman un mismo acto (misma acción, autor y motivo, en el mismo instante).
 */
function groupEvents(rows: AuditEntryDto[]): AuditEntryDto[][] {
  const groups: AuditEntryDto[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1]?.[0];
    const same =
      last &&
      last.action === row.action &&
      last.changedBy.id === row.changedBy.id &&
      last.reason === row.reason &&
      Math.abs(Date.parse(last.changedAt) - Date.parse(row.changedAt)) < 5000;
    if (same) groups[groups.length - 1]!.push(row);
    else groups.push([row]);
  }
  // Dentro de cada acto, los tramos en orden cronológico.
  for (const g of groups) g.sort((a, b) => (a.newValues?.startTime ?? '').localeCompare(b.newValues?.startTime ?? ''));
  return groups;
}

/** Historial inmutable de una jornada: quién cambió qué, cuándo y por qué. */
export function AuditSheet({ workdayId, onClose }: { workdayId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const { data, isPending } = useQuery({
    queryKey: ['audit', workdayId],
    queryFn: () => api<AuditEntryDto[]>(`/time/workdays/${workdayId}/audit`),
    enabled: !!workdayId,
  });

  const range = (v: AuditValues | null): string | null =>
    v?.startTime ? `${formatTime(v.startTime, lang)} – ${v.endTime ? formatTime(v.endTime, lang) : '…'}` : null;
  const when = (iso: string): string =>
    new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  return (
    <Sheet open={!!workdayId} onClose={onClose} title={t('audit.title')} description={t('audit.desc')}>
      {isPending ? (
        <div className="flex justify-center py-10 text-fg-subtle">
          <Spinner className="size-6" />
        </div>
      ) : !data?.length ? (
        <p className="py-8 text-center text-sm text-fg-muted">{t('audit.empty')}</p>
      ) : (
        <ol className="space-y-4 pt-1">
          {groupEvents(data).map((g) => {
            const a = g[0]!;
            const Icon = ICON[a.action];
            return (
              <li key={a.id} className="flex gap-3">
                <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', TONE[a.action])}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t(`audit.action_${a.action}`)}</p>
                  <ul className="mt-1 space-y-0.5">
                    {g.map((row) => {
                      const segment = row.newValues?.entryType ?? row.oldValues?.entryType;
                      return (
                        <li key={row.id} className="flex gap-2 text-sm text-fg-muted">
                          <span className="tabular-nums">{range(row.newValues) ?? range(row.oldValues)}</span>
                          {segment && <span>· {t(`audit.type_${segment}`)}</span>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm">“{a.reason}”</p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {a.changedBy.fullName} · {when(a.changedAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Sheet>
  );
}
