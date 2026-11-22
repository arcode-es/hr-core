import type { LatLng } from '../ui/Map';

export type GeoFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export interface DevicePosition extends LatLng {
  accuracy: number;
}

/** Posición actual del dispositivo con el GPS a máxima precisión. */
export function currentPosition(timeoutMs = 12_000): Promise<DevicePosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject('unsupported' satisfies GeoFailure);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) =>
        reject(
          (e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable') satisfies GeoFailure,
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}

/** true solo si el permiso ya está concedido: permite centrar el mapa sin mostrar un aviso inesperado. */
export async function geolocationGranted(): Promise<boolean> {
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted';
  } catch {
    return false;
  }
}
