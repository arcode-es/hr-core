import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { useToasts } from '../stores/toast';

const icons = { success: CircleCheck, error: CircleAlert, info: Info };
const tones = { success: 'text-success', error: 'text-danger', info: 'text-accent-text' };

export function Toaster() {
  const { t } = useTranslation();
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[100] flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => {
        const Icon = icons[toast.tone];
        return (
          // El mensaje es una región viva que el lector de pantalla anuncia; cerrar es un botón aparte.
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className="animate-toast edge pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-surface py-1.5 pr-1.5 pl-4 text-sm font-medium shadow-pop"
          >
            <Icon className={cn('size-5 shrink-0', tones[toast.tone])} aria-hidden="true" />
            <span className="flex-1 py-1.5">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label={t('common.dismiss')}
              className="focus-ring flex size-9 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
