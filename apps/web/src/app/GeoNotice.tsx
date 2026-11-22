import type { GeoNoticeDto } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import { MapPinned } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api, isNetworkError } from '../lib/api';
import { useSession, useWorkspace } from '../stores/session';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const localKey = (userId: string, orgId: string): string => `hr.geo.${userId}.${orgId}`;

function readLocal(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * Información previa a la geolocalización (art. 90 LOPDGDD). En una empresa, la
 * pantalla de fichar no pide la posición hasta que la persona ha leído el aviso
 * una vez. Sin red se acepta en el dispositivo y se comunica al volver la conexión.
 */
export function GeoNoticeGate({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const userId = useSession((s) => s.user?.id ?? '');
  const reload = useSession((s) => s.reload);
  const orgId = ws.kind === 'organization' ? ws.organizationId : null;
  const key = orgId ? localKey(userId, orgId) : '';
  const [local, setLocal] = useState(() => (key ? readLocal(key) : false));
  const pending = ws.kind === 'organization' && ws.geoNoticeAccepted === false;

  // Aceptado sin red: se avisa al servidor en cuanto se pueda.
  useEffect(() => {
    if (pending && local) void api('/time/geo-notice', { method: 'POST' }).then(() => reload()).catch(() => undefined);
  }, [pending, local, reload]);

  if (!pending || local) return <>{children}</>;
  return (
    <GeoNotice
      onAccept={async () => {
        try {
          await api('/time/geo-notice', { method: 'POST' });
          await reload();
        } catch (e) {
          if (!isNetworkError(e)) throw e;
          try {
            localStorage.setItem(key, '1');
          } catch {
            /* sin almacenamiento: se volverá a mostrar */
          }
          setLocal(true);
        }
      }}
    />
  );
}

function GeoNotice({ onAccept }: { onAccept: () => Promise<void> }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: ['geo-notice', ws.kind === 'organization' ? ws.organizationId : 'personal'], queryFn: () => api<GeoNoticeDto>('/time/geo-notice'), retry: false });
  const org = ws.kind === 'organization' ? ws.name : '';
  const months = data?.photoRetentionMonths ?? 12;
  return (
    <Card className="animate-page space-y-4 p-5 sm:p-6">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
        <MapPinned className="size-6" aria-hidden="true" />
      </span>
      <h2 className="text-xl font-bold tracking-tight">{t('geo.title')}</h2>
      <p>{t('geo.body', { org })}</p>
      <ul className="list-disc space-y-2 pl-5 marker:text-fg-subtle">
        <li>{t('geo.point1')}</li>
        <li>{t('geo.point2')}</li>
        <li>{months ? t('geo.point3', { retention: t('company.retentionMonths', { count: months }) }) : t('geo.point3NoLimit')}</li>
      </ul>
      {data?.companyText && (
        <div className="rounded-2xl bg-surface-2 p-4">
          <p className="mb-1 text-sm font-semibold">{t('geo.company', { org })}</p>
          <p className="text-sm whitespace-pre-line">{data.companyText}</p>
        </div>
      )}
      <p className="text-sm text-fg-muted">
        {t('geo.basis')}{' '}
        <Link to="/legal/privacidad" className="font-semibold text-accent-text hover:underline">
          {t('geo.privacy')}
        </Link>
      </p>
      <Button
        size="lg"
        block
        loading={busy}
        onClick={() => {
          setBusy(true);
          void onAccept().finally(() => setBusy(false));
        }}
      >
        {t('geo.accept')}
      </Button>
    </Card>
  );
}
