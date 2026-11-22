import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GeoPlace } from '@hr/shared';
import type { Env } from '../config/env';

export interface NominatimPlace {
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  error?: string;
  address?: Record<string, string | undefined>;
}

/**
 * Dirección corta y legible: «Calle de Xàtiva 24, 46002 Valencia».
 * Nominatim devuelve toda la jerarquía administrativa (barrio, comarca,
 * provincia, comunidad, país), que no cabe en una lista ni en un informe.
 */
export function formatAddress(p: NominatimPlace): string | null {
  const a = p.address;
  if (!a) return p.display_name ?? null;
  const street = a.road ?? a.pedestrian ?? a.footway ?? a.square ?? a.path;
  const line = street ? [street, a.house_number].filter(Boolean).join(' ') : undefined;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.county;
  const locality = [a.postcode, city].filter(Boolean).join(' ') || undefined;
  // Un lugar con nombre propio (estación, polígono, edificio) va delante de la calle.
  const place = p.name && p.name !== street && p.name !== city ? p.name : undefined;
  const parts = [place, line, locality].filter(Boolean);
  return parts.length ? parts.join(', ') : (p.display_name ?? null);
}

const CACHE_MAX = 2000;
const TIMEOUT_MS = 6000;

/**
 * Geocodificación con Nominatim (OpenStreetMap), sin clave ni coste por uso.
 *
 * Pasa por el servidor para cumplir su política de uso: User-Agent propio,
 * como mucho una petición por segundo y caché de resultados. `GEOCODER_URL`
 * permite apuntar a una instancia propia. Si el servicio falla devuelve
 * vacío: la geocodificación es una ayuda, nunca bloquea guardar ni fichar.
 */
@Injectable()
export class GeoService {
  private readonly log = new Logger(GeoService.name);
  private readonly base: string;
  private readonly userAgent: string;
  private readonly cache = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;

  constructor(config: ConfigService<Env, true>) {
    this.base = config.get('GEOCODER_URL', { infer: true }).replace(/\/$/, '');
    this.userAgent = config.get('GEOCODER_USER_AGENT', { infer: true });
  }

  /** Dirección postal de un punto, o null si no se puede resolver. */
  async reverse(lat: number, lng: number, lang: string): Promise<string | null> {
    // ~11 m de resolución: suficiente para una dirección y mejora los aciertos de caché.
    const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}:${lang}`;
    const place = await this.cached(key, () =>
      this.fetch<NominatimPlace>(`/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat}&lon=${lng}`, lang),
    );
    return place ? formatAddress(place) : null;
  }

  async search(q: string, lang: string): Promise<GeoPlace[]> {
    const key = `s:${q.toLowerCase()}:${lang}`;
    const places = await this.cached(key, () =>
      this.fetch<NominatimPlace[]>(`/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`, lang),
    );
    return (places ?? []).flatMap((p) =>
      p.lat && p.lon ? [{ label: formatAddress(p) ?? '', latitude: Number(p.lat), longitude: Number(p.lon) }] : [],
    );
  }

  private async cached<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const value = await load();
    if (value !== null) {
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, value);
    }
    return value;
  }

  /** Encola las peticiones para respetar el límite de una por segundo. */
  private fetch<T>(path: string, lang: string): Promise<T | null> {
    const run = async (): Promise<T | null> => {
      const wait = this.lastCall + 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      try {
        const res = await fetch(`${this.base}${path}`, {
          headers: { 'User-Agent': this.userAgent, 'Accept-Language': lang, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as T & { error?: string };
        return data && !Array.isArray(data) && data.error ? null : data;
      } catch (e) {
        this.log.warn(`Geocodificador no disponible: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result;
    return result;
  }
}
