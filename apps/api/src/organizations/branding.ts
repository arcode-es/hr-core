import type { Branding } from '@hr/shared';
import { resolveSettings } from '@hr/shared';

/** Lo que el cliente necesita de la marca de la empresa para pintarse. */
export function brandingOf(raw: unknown): Branding {
  const s = resolveSettings(raw);
  return { name: s.brandName || null, accent: s.accentColor || null, logo: !!s.logoKey };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/** Solo PNG o JPEG (un SVG podría llevar código): se reconoce por los primeros bytes, no por el nombre. */
export function logoKind(buf: Buffer): { ext: 'png' | 'jpg'; mime: string } | null {
  if (buf.subarray(0, 4).equals(PNG)) return { ext: 'png', mime: 'image/png' };
  if (buf.subarray(0, 3).equals(JPEG)) return { ext: 'jpg', mime: 'image/jpeg' };
  return null;
}
