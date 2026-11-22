import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiBlob } from '../lib/api';
import { APP_NAME, applyBrand } from '../lib/brand';
import { useSession, useWorkspace } from '../stores/session';
import { Logo } from './Logo';

/** Aplica el color de la empresa activa al cambiar de espacio. */
export function useBrandTheme(): void {
  const ws = useWorkspace();
  const accent = ws.kind === 'organization' ? ws.branding?.accent : undefined;
  useEffect(() => {
    applyBrand(ws.kind === 'organization' ? ws.branding : undefined);
  }, [ws.kind, accent]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Logotipo y nombre de la empresa activa si tiene marca propia; si no, el de la app. */
export function BrandLogo() {
  const ws = useWorkspace();
  const workspaceId = useSession((s) => s.workspaceId);
  const branding = ws.kind === 'organization' ? ws.branding : undefined;
  const { data: url } = useQuery({
    queryKey: ['org-logo', workspaceId],
    queryFn: async () => URL.createObjectURL(await apiBlob('/organization/logo')),
    enabled: !!branding?.logo,
    staleTime: 10 * 60_000,
  });
  if (!branding?.name && !url) return <Logo />;
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      {url ? <img src={url} alt="" className="h-8 max-w-[120px] shrink-0 object-contain" /> : null}
      <span className="truncate text-[17px] font-bold tracking-tight">{branding?.name ?? APP_NAME}</span>
    </span>
  );
}
