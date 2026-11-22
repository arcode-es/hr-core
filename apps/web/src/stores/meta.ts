import type { AppMeta, DeployMode } from '@hr/shared';
import { create } from 'zustand';
import { api } from '../lib/api';

const KEY = 'hr.meta';

function stored(): AppMeta | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as AppMeta | null;
  } catch {
    return null;
  }
}

interface MetaState {
  meta: AppMeta | null;
  /** true tras el primer intento de cargarla, haya red o no. */
  ready: boolean;
  load: () => Promise<void>;
}

/** Cómo está instalada la app (demo, servidor de un cliente o abierta). Se guarda para arrancar sin red. */
export const useMeta = create<MetaState>((set) => ({
  meta: stored(),
  ready: false,
  load: async () => {
    try {
      const meta = await api<AppMeta>('/meta', { auth: false });
      set({ meta, ready: true });
      try {
        localStorage.setItem(KEY, JSON.stringify(meta));
      } catch {
        /* sin almacenamiento: se volverá a pedir */
      }
    } catch {
      set({ ready: true });
    }
  },
}));

export const useMode = (): DeployMode => useMeta((s) => s.meta?.mode ?? 'open');
