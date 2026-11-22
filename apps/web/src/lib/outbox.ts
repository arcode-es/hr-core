import Dexie, { type Table } from 'dexie';
import { create } from 'zustand';
import { api, ApiError, isNetworkError } from './api';
import { queryClient } from './query';

/**
 * Cola de acciones hechas sin conexión. Vive en IndexedDB, así que sobrevive a
 * cerrar la app o reiniciar el móvil, y se vacía sola al volver la red.
 * Cada acción lleva su identificador único: reenviarla nunca la duplica.
 */
export interface OutboxItem {
  id?: number;
  kind: 'clock' | 'expense';
  userId: string;
  workspaceId: string;
  createdAt: number;
  /** JSON del evento, tal como se enviará en el campo `data`. */
  data: string;
  /** Foto de evidencia o ticket. */
  file?: Blob;
}

class OutboxDb extends Dexie {
  items!: Table<OutboxItem, number>;
  constructor() {
    super('hr-outbox');
    this.version(1).stores({ items: '++id, userId, createdAt' });
  }
}

const db = new OutboxDb();

interface OutboxState {
  online: boolean;
  pending: number;
  syncing: boolean;
  /** Acciones que el servidor no aceptó al sincronizar. */
  rejected: number;
  clearRejected: () => void;
}

export const useOutbox = create<OutboxState>((set) => ({
  online: navigator.onLine,
  pending: 0,
  syncing: false,
  rejected: 0,
  clearRejected: () => set({ rejected: 0 }),
}));

let currentUser: string | null = null;

async function recount(): Promise<void> {
  const pending = currentUser ? await db.items.where('userId').equals(currentUser).count().catch(() => 0) : 0;
  useOutbox.setState({ pending });
}

/** Usuario cuyas acciones se sincronizan; las de otra cuenta en el mismo móvil esperan a que vuelva a entrar. */
export function setOutboxUser(userId: string | null): void {
  currentUser = userId;
  void recount().then(() => void flushOutbox());
}

export async function enqueue(item: Omit<OutboxItem, 'id' | 'createdAt' | 'userId'>): Promise<void> {
  if (!currentUser) throw new Error('Sin sesión');
  await db.items.add({ ...item, userId: currentUser, createdAt: Date.now() });
  await recount();
}

export async function pendingClockEvents(workspaceId: string): Promise<number> {
  if (!currentUser) return 0;
  return db.items.where('userId').equals(currentUser).and((i) => i.kind === 'clock' && i.workspaceId === workspaceId).count().catch(() => 0);
}

const ENDPOINT = { clock: { path: '/time/clock', field: 'photo', name: 'evidencia.jpg' }, expense: { path: '/expenses', field: 'receipt', name: 'ticket.jpg' } } as const;

let flushing: Promise<void> | null = null;

/**
 * Envía la cola en orden. Se detiene al primer fallo de red (se reintenta
 * después); lo que el servidor rechaza de forma definitiva se retira y se avisa.
 */
export function flushOutbox(): Promise<void> {
  // El `finally` libera el turno pase lo que pase: un intento sin red no debe bloquear los siguientes.
  flushing ??= send().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function send(): Promise<void> {
  if (!currentUser || !navigator.onLine) return;
  const items = await db.items.where('userId').equals(currentUser).sortBy('createdAt').catch(() => []);
  if (!items.length) return;
  useOutbox.setState({ syncing: true });
  let sent = 0;
  try {
    for (const item of items) {
      const target = ENDPOINT[item.kind];
      const form = new FormData();
      form.append('data', item.data);
      if (item.file) form.append(target.field, item.file, target.name);
      try {
        await api(target.path, { method: 'POST', body: form, workspace: item.workspaceId });
        sent++;
      } catch (e) {
        // Sin red, servidor caído o sesión por renovar: lo dejamos en la cola.
        if (isNetworkError(e) || !(e instanceof ApiError) || e.status >= 500 || e.status === 401 || e.status === 429) break;
        useOutbox.setState((s) => ({ rejected: s.rejected + 1 }));
      }
      await db.items.delete(item.id!);
      await recount();
    }
  } finally {
    useOutbox.setState({ syncing: false });
    await recount();
    if (sent > 0) for (const key of ['clock', 'workdays', 'expenses', 'team-day', 'hours']) void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

// Reintentos: al recuperar la red, al volver a la app y, por si acaso, cada cierto tiempo.
window.addEventListener('online', () => {
  useOutbox.setState({ online: true });
  void flushOutbox();
});
window.addEventListener('offline', () => useOutbox.setState({ online: false }));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void flushOutbox());
setInterval(() => useOutbox.getState().pending > 0 && void flushOutbox(), 20_000);
