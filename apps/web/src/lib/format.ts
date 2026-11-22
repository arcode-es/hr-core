/** 200 → "200 m"; 1500 → "1,5 km" (según idioma). */
export function formatDistance(meters: number, locale: string | undefined): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Cronómetro: 7509 → "2:05:09". */
export function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Resumen: 7509 → "2 h 05 min"; 540 → "9 min". */
export function formatDuration(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

export function formatTime(iso: string, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatDay(iso: string, locale: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
}
