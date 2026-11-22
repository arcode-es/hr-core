import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { NAV, visible } from '../app/nav';
import { cn } from '../lib/cn';
import { useWorkspace } from '../stores/session';
import { usePendingReviews } from './Timesheets';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/Page';

/** En móvil, el resto de apartados que no caben en la barra inferior. */
export function More() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const role = ws.kind === 'organization' ? ws.role : null;
  const pending = usePendingReviews().data?.length ?? 0;
  const items = [NAV.absences, NAV.documents, NAV.reports, NAV.timesheets, NAV.alerts, NAV.team, NAV.sites, NAV.locations, NAV.company, NAV.settings].filter((i) => visible(i, role));

  return (
    <div className="animate-page">
      <PageHeader title={t('nav.more')} />
      <Card className="overflow-hidden">
        {items.map((item, i) => (
          <Link
            key={item.key}
            to={item.to}
            className={cn('focus-ring flex h-16 items-center gap-3.5 px-4 transition-colors hover:bg-surface-2', i > 0 && 'edge-t')}
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
              <item.icon className="size-5" />
            </span>
            <span className="flex-1 font-semibold">{t(`nav.${item.key}`)}</span>
            {item.key === 'timesheets' && pending > 0 && (
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-warning px-2 text-xs font-bold text-white tabular-nums">
                {pending}
              </span>
            )}
            <ChevronRight className="size-5 text-fg-subtle" />
          </Link>
        ))}
      </Card>
    </div>
  );
}
