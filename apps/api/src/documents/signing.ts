import { PDFDocument, PDFFont, rgb, StandardFonts } from 'pdf-lib';

export type DocumentKind = 'pdf' | 'jpg' | 'png';

/** Tipo real del archivo según su cabecera, no según lo que declare el cliente. */
export function documentKind(buf: Buffer): DocumentKind | null {
  if (buf.length > 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'png';
  return null;
}

export const KIND_MIME: Record<DocumentKind, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };

export interface StampData {
  title: string;
  signerName: string;
  signerDni: string;
  /** Fecha y hora local legible, con su zona. */
  signedAtLocal: string;
  /** Instante exacto en UTC (ISO 8601). */
  signedAtUtc: string;
  ip: string | null;
  userAgent: string | null;
  originalSha256: string;
  originalFileName: string;
}

const A4: [number, number] = [595.28, 841.89];
const INK = rgb(0.06, 0.08, 0.14);
const MUTED = rgb(0.38, 0.42, 0.5);
const LINE = rgb(0.82, 0.84, 0.88);

/** Las fuentes estándar de PDF solo cubren WinAnsi: lo que no cabe se sustituye. */
const winAnsi = (s: string): string => s.normalize('NFC').replace(/[^\x20-\x7E\xA1-\xFF€]/g, '?');

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  // Corta también cadenas sin espacios (hashes, user-agents).
  for (const word of text.split(/(?<=\s)|(?<=[/;,])/)) {
    let piece = word;
    while (font.widthOfTextAtSize(piece, size) > maxWidth) {
      let cut = piece.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(piece.slice(0, cut), size) > maxWidth) cut--;
      if (line) lines.push(line.trimEnd());
      lines.push(piece.slice(0, cut));
      line = '';
      piece = piece.slice(cut);
    }
    if (font.widthOfTextAtSize(line + piece, size) > maxWidth && line) {
      lines.push(line.trimEnd());
      line = piece;
    } else line += piece;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** PDF ilegible, cifrado o dañado: no se puede estampar. */
export class UnsignableDocumentError extends Error {}

/**
 * Abre un PDF exigiendo que tenga páginas legibles. pdf-lib tolera archivos
 * dañados (los abre vacíos), así que no basta con que no lance un error.
 */
async function loadPdf(original: Buffer): Promise<PDFDocument> {
  const pdf = await PDFDocument.load(original);
  if (pdf.getPageCount() < 1) throw new UnsignableDocumentError();
  return pdf;
}

/** Comprueba que el archivo se podrá firmar, antes de enviarlo a nadie. */
export async function assertSignable(original: Buffer, kind: DocumentKind): Promise<void> {
  if (kind !== 'pdf') return;
  try {
    await loadPdf(original);
  } catch {
    throw new UnsignableDocumentError();
  }
}

/**
 * Genera el PDF firmado: el documento original intacto, una línea de firma al
 * pie de cada página y una última página de certificado con la rúbrica y los
 * datos de auditoría (firmante, DNI, fecha, IP, navegador y hash del original).
 */
export async function stampSignature(original: Buffer, kind: DocumentKind, signaturePng: Buffer, data: StampData): Promise<Buffer> {
  let pdf: PDFDocument;
  try {
    if (kind === 'pdf') {
      pdf = await loadPdf(original);
    } else {
      // Una imagen (p. ej. un parte fotografiado) se convierte en un PDF de una página.
      pdf = await PDFDocument.create();
      const image = kind === 'jpg' ? await pdf.embedJpg(original) : await pdf.embedPng(original);
      const scale = Math.min((A4[0] - 60) / image.width, (A4[1] - 90) / image.height, 1);
      const page = pdf.addPage(A4);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, { x: (A4[0] - w) / 2, y: A4[1] - 40 - h, width: w, height: h });
    }
  } catch {
    throw new UnsignableDocumentError();
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const signature = await pdf.embedPng(signaturePng).catch(() => {
    throw new UnsignableDocumentError();
  });

  const footer = winAnsi(
    `Firmado digitalmente por ${data.signerName} (${data.signerDni}) el ${data.signedAtLocal} · SHA-256 ${data.originalSha256.slice(0, 16)}…`,
  );
  for (const page of pdf.getPages()) {
    const { width } = page.getSize();
    const size = Math.min(7, (7 * (width - 40)) / font.widthOfTextAtSize(footer, 7));
    page.drawText(footer, { x: 20, y: 10, size, font, color: MUTED });
  }

  // ── Página de certificado ──
  const page = pdf.addPage(A4);
  const left = 56;
  const width = A4[0] - left * 2;
  let y = A4[1] - 72;

  page.drawText(winAnsi('Certificado de firma'), { x: left, y, size: 22, font: bold, color: INK });
  y -= 22;
  page.drawText(winAnsi('Este documento ha sido firmado electrónicamente. Esta página forma parte del documento firmado.'), {
    x: left,
    y,
    size: 9.5,
    font,
    color: MUTED,
  });
  y -= 30;

  const rows: [string, string][] = [
    ['Documento', data.title],
    ['Archivo original', data.originalFileName],
    ['Firmante', data.signerName],
    ['DNI / NIE', data.signerDni],
    ['Fecha y hora', `${data.signedAtLocal}  ·  UTC ${data.signedAtUtc}`],
    ['Dirección IP', data.ip ?? 'No disponible'],
    ['Navegador', data.userAgent ?? 'No disponible'],
    ['SHA-256 del original', data.originalSha256],
  ];
  for (const [label, value] of rows) {
    const lines = wrap(winAnsi(value), font, 10, width - 150);
    page.drawLine({ start: { x: left, y: y + 12 }, end: { x: left + width, y: y + 12 }, thickness: 0.6, color: LINE });
    page.drawText(winAnsi(label), { x: left, y: y - 4, size: 9.5, font: bold, color: MUTED });
    lines.forEach((line, i) => page.drawText(line, { x: left + 150, y: y - 4 - i * 13, size: 10, font, color: INK }));
    y -= Math.max(1, lines.length) * 13 + 14;
  }
  page.drawLine({ start: { x: left, y: y + 12 }, end: { x: left + width, y: y + 12 }, thickness: 0.6, color: LINE });

  y -= 18;
  page.drawText(winAnsi('Firma manuscrita'), { x: left, y, size: 9.5, font: bold, color: MUTED });
  const boxH = 150;
  y -= boxH + 10;
  page.drawRectangle({ x: left, y, width, height: boxH, borderColor: LINE, borderWidth: 1, color: rgb(0.985, 0.985, 0.99) });
  const scale = Math.min((width - 40) / signature.width, (boxH - 24) / signature.height);
  page.drawImage(signature, {
    x: left + (width - signature.width * scale) / 2,
    y: y + (boxH - signature.height * scale) / 2,
    width: signature.width * scale,
    height: signature.height * scale,
  });

  y -= 26;
  for (const line of wrap(
    winAnsi(
      'El hash SHA-256 identifica de forma única el archivo que se firmó: cualquier cambio en el original produce un hash distinto. ' +
        'La firma se trazó en pantalla por el firmante, identificado con su cuenta personal.',
    ),
    font,
    8.5,
    width,
  )) {
    page.drawText(line, { x: left, y, size: 8.5, font, color: MUTED });
    y -= 11.5;
  }

  pdf.setSubject(winAnsi(`Firmado por ${data.signerName} (${data.signerDni}) el ${data.signedAtUtc}`));
  pdf.setKeywords([`sha256:${data.originalSha256}`]);
  return Buffer.from(await pdf.save());
}
