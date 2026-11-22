import type {
  AuthResponse,
  LoginInput,
  MeResponse,
  RegisterInput,
  UserProfile,
  WorkspaceSummary,
} from '@hr/shared';
import { create } from 'zustand';
import { api, isNetworkError, refreshSession, setAccessToken, setApiWorkspace, setOnSessionLost } from '../lib/api';
import { setOutboxUser } from '../lib/outbox';
import i18n from '../i18n';
import { queryClient } from '../lib/query';

const WS_KEY = 'hr.workspace';
const ME_KEY = 'hr.me';

/** Última sesión conocida: permite abrir la app sin red con los datos del usuario. */
function storedMe(): MeResponse | null {
  try {
    return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null') as MeResponse | null;
  } catch {
    return null;
  }
}

const readStoredWorkspace = (): string | null => {
  try {
    return localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
};

// null hasta que el usuario elige: en un dispositivo nuevo se entra en su empresa, si tiene.
let preferred = readStoredWorkspace();

interface SessionState {
  status: 'loading' | 'guest' | 'authed';
  /** true si la sesión terminó porque el usuario la cerró, no porque caducara. */
  signedOut: boolean;
  user: UserProfile | null;
  workspaces: WorkspaceSummary[];
  /** 'personal' o el id de la organización activa. */
  workspaceId: string;
  bootstrap: () => Promise<void>;
  login: (dto: LoginInput) => Promise<void>;
  register: (dto: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  setWorkspace: (id: string) => void;
  setUser: (u: UserProfile) => void;
}

export const useSession = create<SessionState>((set, get) => {
  const applyMe = (me: MeResponse): void => {
    const orgs = me.workspaces.flatMap((w) => (w.kind === 'organization' ? [w.organizationId] : []));
    // Si el espacio elegido ya no existe (p. ej. me dieron de baja), vuelve al personal o, donde
    // no hay espacio personal (demo, servidor de un cliente), a la primera empresa.
    const hasPersonal = me.workspaces.some((w) => w.kind === 'personal');
    const fallback = hasPersonal ? 'personal' : (orgs[0] ?? 'personal');
    const workspaceId = preferred === null ? (orgs[0] ?? 'personal') : orgs.includes(preferred) || (preferred === 'personal' && hasPersonal) ? preferred : fallback;
    setApiWorkspace(workspaceId);
    try {
      localStorage.setItem(ME_KEY, JSON.stringify(me));
    } catch {
      /* sin almacenamiento: no habrá arranque sin conexión */
    }
    set({ status: 'authed', signedOut: false, user: me.user, workspaces: me.workspaces, workspaceId });
    setOutboxUser(me.user.id);
  };

  const enter = async (res: AuthResponse): Promise<void> => {
    setAccessToken(res.accessToken);
    applyMe(await api<MeResponse>('/me'));
  };

  /**
   * Cierra la sesión local. Al arrancar no se vacía la caché de consultas: mientras dura el arranque
   * las rutas privadas no se pintan, así que solo puede haber consultas públicas en marcha (la
   * comprobación del enlace de recuperación o de una invitación) y vaciarla las dejaría colgadas.
   */
  const clear = (wipeQueries = true): void => {
    setAccessToken(null);
    setOutboxUser(null);
    try {
      localStorage.removeItem(ME_KEY);
    } catch {
      /* nada que limpiar */
    }
    if (wipeQueries) queryClient.clear();
    set({ status: 'guest', user: null, workspaces: [] });
  };

  setOnSessionLost(() => clear());

  return {
    status: 'loading',
    signedOut: false,
    user: null,
    workspaces: [],
    workspaceId: preferred ?? 'personal',

    bootstrap: async () => {
      const refreshed = await refreshSession();
      if (refreshed === 'denied') return clear(false);
      const known = storedMe();
      if (refreshed === 'offline') {
        // Sin red al abrir: se entra con la última sesión conocida y se sincroniza después.
        return known ? applyMe(known) : clear(false);
      }
      try {
        const me = await api<MeResponse>('/me');
        applyMe(me);
        if (!localStorage.getItem('i18nextLng')) void i18n.changeLanguage(me.user.locale);
      } catch (e) {
        if (isNetworkError(e) && known) applyMe(known);
        else clear(false);
      }
    },

    login: async (dto) => enter(await api<AuthResponse>('/auth/login', { method: 'POST', body: dto, auth: false })),

    register: async (dto) =>
      enter(await api<AuthResponse>('/auth/register', { method: 'POST', body: dto, auth: false })),

    logout: async () => {
      await api('/auth/logout', { method: 'POST', auth: false }).catch(() => undefined);
      clear();
      set({ signedOut: true });
    },

    reload: async () => applyMe(await api<MeResponse>('/me')),

    setWorkspace: (id) => {
      preferred = id;
      setApiWorkspace(id);
      try {
        localStorage.setItem(WS_KEY, id);
      } catch {
        /* almacenamiento no disponible: la preferencia dura lo que la sesión */
      }
      set({ workspaceId: id });
    },

    setUser: (user) => set({ user }),
  };
});

/** Espacio activo, con el rol si es una organización. */
export function useWorkspace(): WorkspaceSummary {
  const { workspaces, workspaceId } = useSession();
  return (
    workspaces.find((w) => w.kind === 'organization' && w.organizationId === workspaceId) ?? { kind: 'personal' }
  );
}
