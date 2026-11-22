import type { NotificationDto, NotificationList, NotificationTypeId } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, CalendarClock, CalendarDays, CalendarOff, CheckCheck, ClipboardCheck, FileSignature, FileText, type LucideIcon, Receipt, ShieldAlert, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { queryClient } from '../lib/query';
import { useSession } from '../stores/session';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';

const ICON: Record<NotificationTypeId, LucideIcon> = {
  SHIFT_PUBLISHED: CalendarDays,
  SHIFT_UPDATED: CalendarDays,
  TIME_ENTRY_PENDING: ClipboardCheck,
  TIME_ENTRY_REVIEWED: ClipboardCheck,
  EXPENSE_PENDING: Receipt,
  EXPENSE_REVIEWED: Receipt,
  DOCUMENT_RECEIVED: FileText,
  DOCUMENT_SIGNED: FileSignature,
  INVITATION: UserPlus,
  ABSENCE_PENDING: CalendarOff,
  ABSENCE_REVIEWED: CalendarOff,
  ALERT: ShieldAlert,
  DOCUMENT_REMINDER: CalendarClock,
};

/** Clave de traducción según el aviso: algunos cambian de texto con su contenido. */
function messageKey(n: NotificationDto): string {
  if (n.type === 'TIME_ENTRY_REVIEWED' || n.type === 'EXPENSE_REVIEWED' || n.type === 'ABSENCE_REVIEWED') return `notifications.${n.type}_${n.payload.approved ? 'approved' : 'rejected'}`;
  if (n.type === 'DOCUMENT_RECEIVED') return `notifications.DOCUMENT_RECEIVED_${n.payload.requiresSignature ? 'sign' : 'read'}`;
  // La misma alerta llega a la persona (sin nombre) y a quien supervisa (con nombre).
  if (n.type === 'DOCUMENT_REMINDER') return `notifications.DOCUMENT_REMINDER_${n.payload.overdue ? 'overdue' : 'due'}`;
  if (n.type === 'ALERT') return `notifications.ALERT_${n.payload.alertKind}${n.payload.name ? '' : '_self'}`;
  return `notifications.${n.type}`;
}

function ago(iso: string, locale: string | undefined): string {
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(seconds) < 3600) return f.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86_400) return f.format(Math.round(seconds / 3600), 'hour');
  return f.format(Math.round(seconds / 86_400), 'day');
}

export function useNotifications() {
  return useQuery({ queryKey: ['notifications'], queryFn: () => api<NotificationList>('/notifications'), refetchInterval: 60_000, refetchOnWindowFocus: true });
}

/** Campana con el número de avisos sin leer y la lista al tocarla. */
export function NotificationsBell({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId, setWorkspace, workspaces } = useSession();
  const { data, isPending } = useNotifications();
  const [open, setOpen] = useState(false);
  const unread = data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api<void>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const go = (n: NotificationDto): void => {
    setOpen(false);
    if (!n.read) markRead.mutate([n.id]);
    // El aviso puede ser de otra empresa: se cambia a su espacio antes de abrirlo.
    const target = n.organizationId ?? 'personal';
    const reachable = target === 'personal' || workspaces.some((w) => w.kind === 'organization' && w.organizationId === target);
    if (reachable && target !== workspaceId) {
      setWorkspace(target);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'notifications' });
    }
    void navigate(n.payload.link);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread ? t('notifications.openUnread', { count: unread }) : t('notifications.open')}
        className={cn('focus-ring relative flex size-10 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg', className)}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white tabular-nums ring-2 ring-bg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('notifications.title')} className="sm:max-w-lg">
        {isPending ? (
          <div className="flex justify-center py-10 text-fg-subtle">
            <Spinner className="size-6" />
          </div>
        ) : !data?.items.length ? (
          <p className="py-10 text-center text-sm text-fg-muted">{t('notifications.empty')}</p>
        ) : (
          <>
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="mb-1 -ml-2" loading={markRead.isPending} onClick={() => markRead.mutate(undefined)} icon={<CheckCheck className="size-4" />}>
                {t('notifications.markAll')}
              </Button>
            )}
            <ul className="-mx-2">
              {data.items.map((n) => {
                const Icon = ICON[n.type];
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => go(n)} className="focus-ring flex w-full items-start gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-surface-2">
                      <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl', n.read ? 'bg-surface-2 text-fg-muted' : 'bg-accent-soft text-accent-text')}>
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm', n.read ? 'text-fg-muted' : 'font-semibold')}>{t(messageKey(n), { ...n.payload, date: n.payload.dueDate ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${n.payload.dueDate}T00:00:00Z`)) : undefined })}</span>
                        <span className="block text-xs text-fg-subtle">
                          {ago(n.createdAt, i18n.resolvedLanguage)}
                          {n.organizationName && ` · ${n.organizationName}`}
                        </span>
                      </span>
                      {!n.read && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-accent" aria-label={t('notifications.unread')} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Sheet>
    </>
  );
}
