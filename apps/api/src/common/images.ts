/** Solo JPEG o WebP reales: se mira la cabecera del archivo, no el tipo que declara el cliente. */
export function imageExtension(buf: Buffer): 'jpg' | 'webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export const imageMime = (ext: 'jpg' | 'webp'): string => (ext === 'jpg' ? 'image/jpeg' : 'image/webp');

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
