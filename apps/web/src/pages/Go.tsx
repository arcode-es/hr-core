import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { queryClient } from '../lib/query';
import { useSession } from '../stores/session';

/** Destino de las notificaciones push: abre el aviso en el espacio (empresa) al que pertenece. */
export function Go() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { workspaces, workspaceId, setWorkspace } = useSession();

  useEffect(() => {
    const ws = params.get('ws');
    const to = params.get('to') ?? '/';
    if (ws && ws !== workspaceId && workspaces.some((w) => w.kind === 'organization' && w.organizationId === ws)) {
      setWorkspace(ws);
      queryClient.clear();
    }
    // Solo rutas internas.
    void navigate(to.startsWith('/') && !to.startsWith('//') ? to : '/', { replace: true });
  }, [params, navigate, workspaces, workspaceId, setWorkspace]);

  return null;
}
