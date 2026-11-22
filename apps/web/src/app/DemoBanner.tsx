import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMode } from '../stores/meta';

/** Aviso fijo en la demo pública: los datos son ficticios y se restablecen cada noche. */
export function DemoBanner() {
  const { t } = useTranslation();
  if (useMode() !== 'demo') return null;
  return (
    <div role="note" className="flex items-center justify-center gap-2 bg-warning-soft px-4 py-2 text-center text-sm font-medium text-warning-text">
      <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
      <span>{t('demo.banner')}</span>
    </div>
  );
}
