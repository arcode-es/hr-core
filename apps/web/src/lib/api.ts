import type { AuthResponse, ErrorCode } from '@hr/shared';
import { saveBlob } from './download';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK' | 'UNKNOWN',
  ) {
    super(code);
  }
}

/** true si el fallo es de red (sin cobertura, servidor inalcanzable), no una respuesta del servidor. */
export const isNetworkError = (e: unknown): boolean => e instanceof ApiError && e.code === 'NETWORK';

// El token de acceso vive solo en memoria; el de renovación, en una cookie httpOnly.
let accessToken: string | null = null;
let workspace = 'personal';
let onSessionLost: () => void = () => {};

export const setAccessToken = (t: string | null): void => void (accessToken = t);
export const setApiWorkspace = (w: string): void => void (workspace = w);
export const setOnSessionLost = (fn: () => void): void => void (onSessionLost = fn);

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** false en las rutas de /auth, que no llevan token ni reintento. */
  auth?: boolean;
  /** Espacio de esta petición, si no es el activo (cola sin conexión). */
  workspace?: string;
}

async function raw(path: string, { method = 'GET', body, auth = true, workspace: ws }: Options): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json, */*' };
  const form = body instanceof FormData;
  // Con FormData el navegador pone el Content-Type con su separador.
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
    headers['X-Workspace'] = ws ?? workspace;
  }
  try {
    return await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
}

async function fail(res: Response): Promise<never> {
  const data: unknown = await res.json().catch(() => null);
  throw new ApiError(res.status, res.status === 429 ? 'RATE_LIMITED' : ((data as { code?: ErrorCode } | null)?.code ?? 'UNKNOWN'));
}

export type RefreshResult = 'ok' | 'denied' | 'offline';
let refreshing: Promise<RefreshResult> | null = null;

/**
 * Renueva la sesión. Varias llamadas simultáneas comparten una única petición.
 * Distingue «el servidor dice que no» de «no hay red»: sin red la sesión no se pierde.
 */
export function refreshSession(): Promise<RefreshResult> {
  refreshing ??= (async (): Promise<RefreshResult> => {
    try {
      const res = await raw('/auth/refresh', { method: 'POST', auth: false });
      if (res.status >= 500) return 'offline';
      if (!res.ok) return 'denied';
      accessToken = ((await res.json()) as AuthResponse).accessToken;
      return 'ok';
    } catch {
      return 'offline';
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Petición con sesión: si el token ha caducado, lo renueva una vez y reintenta. */
async function authed(path: string, options: Options): Promise<Response> {
  const res = await raw(path, options);
  if (res.status !== 401 || options.auth === false) return res;
  const refreshed = await refreshSession();
  if (refreshed === 'ok') return raw(path, options);
  if (refreshed === 'offline') throw new ApiError(0, 'NETWORK');
  onSessionLost();
  throw new ApiError(401, 'SESSION_EXPIRED');
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const res = await authed(path, options);
  if (!res.ok) return fail(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Descarga un archivo protegido con la sesión del usuario (visor de documentos). */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await authed(path, {});
  if (!res.ok) return fail(res);
  return res.blob();
}

/** Descarga un archivo y lo guarda con el nombre que propone el servidor. */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const res = await authed(path, {});
  if (!res.ok) return fail(res);
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  saveBlob(await res.blob(), name);
}
