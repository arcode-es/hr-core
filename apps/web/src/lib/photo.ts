const MAX_SIDE = 1600;
const MAX_BYTES = 1024 * 1024;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // Respeta la orientación EXIF: las fotos del móvil no salen giradas.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', quality),
  );

/**
 * Prepara una foto para subirla: la reduce, le estampa una franja inferior con
 * los datos de evidencia y la comprime por debajo de 1 MB manteniendo el texto legible.
 * Todo ocurre en el dispositivo, así que funciona también sin conexión.
 */
export async function stampPhoto(file: Blob, lines: string[]): Promise<Blob> {
  const img = await decode(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if ('close' in img) img.close();

  if (lines.length) {
    const font = Math.max(14, Math.round(canvas.width / 38));
    const pad = Math.round(font * 0.7);
    const band = lines.length * Math.round(font * 1.35) + pad * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, canvas.height - band, canvas.width, band);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, pad, canvas.height - band + pad + i * Math.round(font * 1.35), canvas.width - pad * 2);
    });
  }

  let quality = 0.82;
  let blob = await toJpeg(canvas, quality);
  while (blob.size > MAX_BYTES && quality > 0.45) {
    quality -= 0.1;
    blob = await toJpeg(canvas, quality);
  }
  return blob;
}

/** Texto de la marca de agua: fecha y hora local y UTC, y coordenadas con su precisión. */
export function evidenceLines(now: Date, pos: { lat: number; lng: number; accuracy: number } | null, noPosition: string): string[] {
  const p = (n: number): string => String(n).padStart(2, '0');
  const date = `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}`;
  const local = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  const utc = `${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())}`;
  return [
    `${date} ${local} (UTC ${utc})`,
    pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} ±${Math.round(pos.accuracy)} m` : noPosition,
  ];
}
