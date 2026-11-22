import { api } from './api';

export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

const supported = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function toBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Service worker activo, o null si no lo hay (p. ej. en desarrollo, donde no se registra). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.active ? reg : null;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'unavailable';
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

/** Pide permiso, suscribe este dispositivo y lo registra en el servidor. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const { publicKey } = await api<{ publicKey: string | null }>('/push/key');
  const reg = await registration();
  if (!publicKey || !reg) return 'unavailable';
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'off';
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) }));
  await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) {
    await api('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}
