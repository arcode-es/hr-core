import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';

/** Imagen PNG de un código QR (corrección de errores media, margen mínimo). */
export const qrPng = (text: string, width = 900): Promise<Buffer> => QRCode.toBuffer(text, { type: 'png', width, margin: 1, errorCorrectionLevel: 'M' });

/** Las fuentes estándar de PDF solo cubren WinAnsi: lo que no cabe se sustituye. */
const winAnsi = (s: string): string => s.normalize('NFC').replace(/[^\x20-\x7E\xA1-\xFF€]/g, '?');

/** Cartel A4 con un QR grande, título y explicación: para pegar en la obra o el centro. */
export async function qrPoster(p: { title: string; subtitle: string; lines: string[]; qrText: string; footer: string }): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(p.title));
  pdf.setProducer('HR-Core');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const ink = rgb(0.07, 0.09, 0.15);
  const muted = rgb(0.38, 0.42, 0.5);
  const center = (text: string, y: number, size: number, f = font, color = ink): void => {
    const t = winAnsi(text);
    page.drawText(t, { x: (595.28 - f.widthOfTextAtSize(t, size)) / 2, y, size, font: f, color });
  };
  center(p.title, 770, 24, bold);
  center(p.subtitle, 740, 13, font, muted);
  const img = await pdf.embedPng(await qrPng(p.qrText));
  const size = 380;
  page.drawImage(img, { x: (595.28 - size) / 2, y: 320, width: size, height: size });
  let y = 280;
  for (const line of p.lines) {
    center(line, y, 13);
    y -= 22;
  }
  center(p.footer, 60, 9, font, muted);
  return Buffer.from(await pdf.save());
}

/** Tarjeta personal (tamaño tarjeta de crédito, centrada en un A4 para imprimir y recortar). */
export async function qrCard(p: { name: string; organization: string; qrText: string }): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(`Tarjeta de fichaje - ${p.name}`));
  pdf.setProducer('HR-Core');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]);
  const mm = 72 / 25.4;
  const w = 85.6 * mm;
  const h = 54 * mm;
  const x = (595.28 - w) / 2;
  const y = 600;
  page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.8, 0.82, 0.86), borderWidth: 0.8, color: rgb(1, 1, 1) });
  page.drawRectangle({ x, y: y + h - 9 * mm, width: w, height: 9 * mm, color: rgb(0.31, 0.27, 0.9) });
  page.drawText('HR-Core', { x: x + 4 * mm, y: y + h - 6 * mm, size: 11, font: bold, color: rgb(1, 1, 1) });
  const img = await pdf.embedPng(await qrPng(p.qrText, 400));
  const q = 36 * mm;
  page.drawImage(img, { x: x + w - q - 4 * mm, y: y + 4 * mm, width: q, height: q });
  page.drawText(winAnsi(p.name), { x: x + 4 * mm, y: y + 24 * mm, size: 11, font: bold, color: rgb(0.07, 0.09, 0.15), maxWidth: w - q - 10 * mm });
  page.drawText(winAnsi(p.organization), { x: x + 4 * mm, y: y + 18 * mm, size: 8, font, color: rgb(0.38, 0.42, 0.5), maxWidth: w - q - 10 * mm });
  page.drawText(winAnsi('Tarjeta para fichar en el quiosco.'), { x: x + 4 * mm, y: y + 8 * mm, size: 7, font, color: rgb(0.38, 0.42, 0.5) });
  page.drawText(winAnsi('Siempre se pide tu PIN.'), { x: x + 4 * mm, y: y + 5 * mm, size: 7, font, color: rgb(0.38, 0.42, 0.5) });
  page.drawText(winAnsi('Recorta por la línea. Si la pierdes, pide otra: la anterior deja de valer.'), {
    x: x,
    y: y - 18,
    size: 8,
    font,
    color: rgb(0.38, 0.42, 0.5),
  });
  return Buffer.from(await pdf.save());
}
