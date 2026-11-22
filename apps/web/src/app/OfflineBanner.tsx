import { CloudOff, CloudUpload, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { flushOutbox, useOutbox } from '../lib/outbox';
import { cn } from '../lib/cn';
import { Spinner } from '../ui/Spinner';

/**
 * Estado de la conexión y de la cola local, siempre a la vista: quien ficha en
 * un sótano tiene que saber que su fichaje está guardado y que se enviará.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { online, pending, syncing, rejected, clearRejected } = useOutbox();

  if (online && pending === 0 && rejected === 0) return null;

  if (rejected > 0 && pending === 0) {
    return (
      <div role="alert" className="flex items-center gap-2.5 bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger-text">
        <TriangleAlert className="size-4 shrink-0" />
        <span className="flex-1">{t('offline.rejected', { count: rejected })}</span>
        <button type="button" onClick={clearRejected} aria-label={t('common.close')} className="focus-ring flex size-8 items-center justify-center rounded-full">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const Icon = online ? CloudUpload : CloudOff;
  return (
    <div role="status" className={cn('flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium', online ? 'bg-accent-soft text-accent-text' : 'bg-warning-soft text-warning-text')}>
      {syncing ? <Spinner className="size-4 shrink-0" /> : <Icon className="size-4 shrink-0" />}
      <span className="flex-1">
        {!online ? (pending > 0 ? t('offline.offlinePending', { count: pending }) : t('offline.offline')) : syncing ? t('offline.syncing', { count: pending }) : t('offline.pending', { count: pending })}
      </span>
      {online && !syncing && pending > 0 && (
        <button type="button" onClick={() => void flushOutbox()} className="focus-ring rounded px-1 font-semibold underline">
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
