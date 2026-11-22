import type { LocationDto } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MapPin, MapPinPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { formatDistance } from '../lib/format';
import { useSession, useWorkspace } from '../stores/session';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { LocationsOverviewMap } from '../ui/Map';
import { EmptyState, PageHeader } from '../ui/Page';
import { Spinner } from '../ui/Spinner';

export const locationsKey = (workspaceId: string) => ['locations', workspaceId] as const;

export function useCanManageLocations(): boolean {
  const ws = useWorkspace();
  return ws.kind === 'personal' || ws.role === 'ADMIN' || ws.role === 'MANAGER';
}

export function Locations() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const workspaceId = useSession((s) => s.workspaceId);
  const canManage = useCanManageLocations();
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: locationsKey(workspaceId),
    queryFn: () => api<LocationDto[]>('/locations'),
  });

  const list = data ?? [];
  const active = list.filter((l) => l.isActive).length;
  const addButton = canManage && (
    <Link to="/locations/new">
      <Button icon={<MapPinPlus className="size-[18px]" />}>{t('locations.add')}</Button>
    </Link>
  );

  return (
    <div className="animate-page">
      <PageHeader
        title={t('locations.title')}
        subtitle={data ? t('locations.count', { count: active }) : undefined}
        action={list.length > 0 && addButton}
      />

      {isPending ? (
        <div className="flex justify-center py-16 text-fg-subtle">
          <Spinner className="size-6" />
        </div>
      ) : isError ? (
        <Card>
          <EmptyState
            icon={<MapPin />}
            title={errorMessage(t, error)}
            body=""
            action={<Button variant="secondary" onClick={() => void refetch()}>{t('common.retry')}</Button>}
          />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MapPin />}
            title={t('locations.emptyTitle')}
            body={canManage ? t('locations.emptyBody') : t('locations.emptyBodyEmployee')}
            action={addButton}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="h-56 overflow-hidden sm:h-72">
            <LocationsOverviewMap
              locations={list}
              label={t('locations.mapLabel')}
              onSelect={canManage ? (id) => void navigate(`/locations/${id}`) : undefined}
            />
          </Card>
          <Card className="overflow-hidden">
            <ul>
              {list.map((l, i) => {
                const row = (
                  <>
                    <span
                      className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl text-white', !l.isActive && 'opacity-40 grayscale')}
                      style={{ backgroundColor: l.color }}
                    >
                      <MapPin className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate font-semibold', !l.isActive && 'text-fg-muted')}>{l.name}</span>
                      <span className="block truncate text-sm text-fg-muted">{l.address ?? t('locations.noAddress')}</span>
                    </span>
                    {l.isActive ? (
                      <Badge>{t('locations.radiusBadge', { distance: formatDistance(l.geofenceRadiusMeters, i18n.resolvedLanguage) })}</Badge>
                    ) : (
                      <Badge tone="warning">{t('locations.inactive')}</Badge>
                    )}
                    {canManage && <ChevronRight className="size-5 shrink-0 text-fg-subtle" />}
                  </>
                );
                const cls = cn('flex w-full items-center gap-3 px-4 py-3 text-left', i > 0 && 'edge-t');
                return (
                  <li key={l.id}>
                    {canManage ? (
                      <Link to={`/locations/${l.id}`} className={cn(cls, 'focus-ring transition-colors hover:bg-surface-2')}>
                        {row}
                      </Link>
                    ) : (
                      <div className={cls}>{row}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
