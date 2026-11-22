import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { deflateSync } from 'node:zlib';

/*
 * Rúbrica y PDF de la demo, generados al sembrar: cada reinicio deja exactamente lo mismo.
 * Las fotos (JPEG) están en images.ts; las generó una vez scripts/demo-images.py.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

type Pixel = [number, number, number, number];

/** PNG RGBA de 8 bits a partir de una función que pinta cada píxel. */
export function png(width: number, height: number, paint: (x: number, y: number) => Pixel): Buffer {
  const row = width * 4 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      const i = y * row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Generador pseudoaleatorio determinista: la demo sale igual cada noche. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Rúbrica dibujada en la pantalla: un trazo continuo sobre fondo transparente. */
export function signaturePng(seed: number): Buffer {
  const rnd = seeded(seed);
  const w = 480;
  const h = 160;
  const a1 = 18 + rnd() * 14;
  const a2 = 8 + rnd() * 10;
  const f1 = 0.018 + rnd() * 0.01;
  const f2 = 0.05 + rnd() * 0.03;
  const curve = (x: number): number => h / 2 + a1 * Math.sin(x * f1) + a2 * Math.sin(x * f2 + 1);
  return png(w, h, (x, y) => {
    if (x < 30 || x > w - 40) return [0, 0, 0, 0];
    const d = Math.abs(y - curve(x));
    if (d < 1.6) return [17, 24, 39, 255];
    if (d < 2.6) return [17, 24, 39, 120];
    return [0, 0, 0, 0];
  });
}

/** PDF A4 de texto: título, subtítulo y párrafos con salto de línea automático. */
export async function textPdf(title: string, subtitle: string, paragraphs: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer('HR-Core (demo)');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.09, 0.15);
  const muted = rgb(0.38, 0.42, 0.5);
  const margin = 64;
  const width = 595.28 - margin * 2;
  let page = pdf.addPage([595.28, 841.89]);
  let y = 770;

  page.drawText(title, { x: margin, y, size: 18, font: bold, color: ink });
  y -= 22;
  page.drawText(subtitle, { x: margin, y, size: 10, font, color: muted });
  y -= 34;

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    let line = '';
    const flush = (): void => {
      if (y < 80) {
        page = pdf.addPage([595.28, 841.89]);
        y = 770;
      }
      page.drawText(line, { x: margin, y, size: 11, font, color: ink });
      y -= 16;
      line = '';
    };
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, 11) > width) {
        flush();
        line = word;
      } else line = next;
    }
    if (line) flush();
    y -= 10;
  }
  return Buffer.from(await pdf.save());
}

/** Recibo de salarios de ejemplo, con el DNI visible (lo usará el reparto de nóminas). */
export async function payslipPdf(p: { company: string; taxId: string; name: string; dni: string; month: string; gross: number; net: number }): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Nómina ${p.month} · ${p.name}`);
  pdf.setProducer('HR-Core (demo)');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.09, 0.15);
  const muted = rgb(0.38, 0.42, 0.5);
  const line = rgb(0.82, 0.84, 0.88);
  const page = pdf.addPage([595.28, 841.89]);
  const eur = (n: number): string => `${n.toFixed(2).replace('.', ',')} EUR`;

  page.drawText('RECIBO INDIVIDUAL DE SALARIOS', { x: 64, y: 770, size: 15, font: bold, color: ink });
  page.drawText(`Periodo de liquidación: ${p.month}`, { x: 64, y: 748, size: 10, font, color: muted });
  page.drawText(`Empresa: ${p.company}  ·  CIF ${p.taxId}`, { x: 64, y: 712, size: 11, font, color: ink });
  page.drawText(`Trabajador/a: ${p.name}  ·  DNI ${p.dni}`, { x: 64, y: 694, size: 11, font, color: ink });
  page.drawLine({ start: { x: 64, y: 676 }, end: { x: 531, y: 676 }, thickness: 1, color: line });

  const rows: [string, string][] = [
    ['Salario base', eur(p.gross * 0.78)],
    ['Plus de convenio', eur(p.gross * 0.12)],
    ['Horas extraordinarias', eur(p.gross * 0.1)],
    ['Total devengado', eur(p.gross)],
    ['Contingencias comunes y desempleo', `-${eur(p.gross * 0.0655)}`],
    ['Retención IRPF', `-${eur(p.gross - p.net - p.gross * 0.0655)}`],
  ];
  let y = 650;
  for (const [label, amount] of rows) {
    page.drawText(label, { x: 64, y, size: 11, font, color: ink });
    page.drawText(amount, { x: 531 - font.widthOfTextAtSize(amount, 11), y, size: 11, font, color: ink });
    y -= 22;
  }
  page.drawLine({ start: { x: 64, y: y + 8 }, end: { x: 531, y: y + 8 }, thickness: 1, color: line });
  const net = eur(p.net);
  page.drawText('LÍQUIDO A PERCIBIR', { x: 64, y: y - 14, size: 12, font: bold, color: ink });
  page.drawText(net, { x: 531 - bold.widthOfTextAtSize(net, 12), y: y - 14, size: 12, font: bold, color: ink });
  page.drawText('Documento de ejemplo generado para la demostración de HR-Core.', { x: 64, y: 80, size: 9, font, color: muted });
  return Buffer.from(await pdf.save());
}
