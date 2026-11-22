import type { ErrorCode, KioskInfo } from '@hr/shared';
import Dexie, { type Table } from 'dexie';
import { create } from 'zustand';
import { API_URL, ApiError, isNetworkError } from './api';

/*
 * La tablet del quiosco no tiene sesión de nadie: se identifica con su propio token,
 * que se guarda en el navegador al emparejarla. Cada persona se identifica después
 * con su PIN, y ese permiso solo sirve para fichar desde esta tablet.
 */

const TOKEN_KEY = 'hr.kiosk.token';
const INFO_KEY = 'hr.kiosk.info';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: habrá que volver a emparejar */
  }
};

export const kioskToken = (): string | null => read(TOKEN_KEY);
export const cachedInfo = (): KioskInfo | null => {
  try {
    return JSON.parse(read(INFO_KEY) ?? 'null') as KioskInfo | null;
  } catch {
    return null;
  }
};
export const saveKiosk = (token: string, info: KioskInfo): void => {
  write(TOKEN_KEY, token);
  write(INFO_KEY, JSON.stringify(info));
};
export const saveInfo = (info: KioskInfo): void => write(INFO_KEY, JSON.stringify(info));
export const forgetKiosk = (): void => {
  write(TOKEN_KEY, null);
  write(INFO_KEY, null);
  void db.items.clear().catch(() => undefined);
  useKioskOutbox.setState({ pending: 0 });
};

export async function kioskApi<T>(path: string, { method = 'GET', body }: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = kioskToken();
  if (token) headers['X-Kiosk-Token'] = token;
  const form = body instanceof FormData;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { code?: ErrorCode } | null;
    throw new ApiError(res.status, res.status === 429 ? 'RATE_LIMITED' : (data?.code ?? 'UNKNOWN'));
  }
  return (await res.json()) as T;
}

// ── Cola sin conexión de la tablet ───────────────────────────────────────

interface KioskItem {
  id?: number;
  createdAt: number;
  data: string;
  file?: Blob;
}

class KioskDb extends Dexie {
  items!: Table<KioskItem, number>;
  constructor() {
    super('hr-kiosk-outbox');
    this.version(1).stores({ items: '++id, createdAt' });
  }
}
const db = new KioskDb();

export const useKioskOutbox = create<{ pending: number; online: boolean }>(() => ({ pending: 0, online: navigator.onLine }));

async function recount(): Promise<void> {
  useKioskOutbox.setState({ pending: await db.items.count().catch(() => 0) });
}

const form = (data: string, file?: Blob): FormData => {
  const f = new FormData();
  f.append('data', data);
  if (file) f.append('photo', file, 'quiosco.jpg');
  return f;
};

/** Envía el fichaje; sin red lo guarda para enviarlo después con la hora en que ocurrió. */
export async function sendKioskClock(data: Record<string, unknown>, file?: Blob): Promise<{ queued: boolean }> {
  if (navigator.onLine && (await db.items.count().catch(() => 0)) === 0) {
    try {
      await kioskApi('/kiosk/clock', { method: 'POST', body: form(JSON.stringify(data), file) });
      return { queued: false };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  await db.items.add({ createdAt: Date.now(), data: JSON.stringify({ ...data, occurredAt: new Date().toISOString() }), file });
  await recount();
  return { queued: true };
}

let flushing: Promise<void> | null = null;

export function flushKiosk(): Promise<void> {
  flushing ??= (async () => {
    if (!navigator.onLine || !kioskToken()) return;
    const items = await db.items.orderBy('createdAt').toArray().catch(() => []);
    for (const item of items) {
      try {
        await kioskApi('/kiosk/clock', { method: 'POST', body: form(item.data, item.file) });
      } catch (e) {
        // Sin red, servidor caído o tablet revocada: se reintenta más tarde.
        if (isNetworkError(e) || !(e instanceof ApiError) || e.status >= 500 || e.status === 429 || e.code === 'KIOSK_INVALID') break;
        // Rechazo definitivo (ya no encaja con sus fichajes): se descarta.
      }
      await db.items.delete(item.id!);
    }
  })().finally(() => {
    flushing = null;
    void recount();
  });
  return flushing;
}

export function startKioskSync(): () => void {
  void recount().then(() => void flushKiosk());
  const online = (): void => {
    useKioskOutbox.setState({ online: true });
    void flushKiosk();
  };
  const offline = (): void => useKioskOutbox.setState({ online: false });
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  const timer = window.setInterval(() => void flushKiosk(), 30_000);
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.clearInterval(timer);
  };
}
