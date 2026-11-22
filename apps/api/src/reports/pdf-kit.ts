import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, StandardFonts } from 'pdf-lib';

export const INK = rgb(0.06, 0.08, 0.14);
export const MUTED = rgb(0.38, 0.42, 0.5);
export const LINE = rgb(0.82, 0.84, 0.88);
export const SOFT = rgb(0.95, 0.96, 0.98);
export const ACCENT = rgb(0.31, 0.27, 0.9);

/** Las fuentes estándar de PDF solo cubren WinAnsi: lo que no cabe se sustituye. */
export const winAnsi = (s: string): string =>
  s
    .normalize('NFC')
    // Los espacios duros que usa Intl en importes («23,90 €») pasan a espacios normales.
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/[^\x20-\x7E\xA1-\xFF€–—…]/g, '?');

export interface Column {
  header: string;
  /** Ancho relativo. */
  width: number;
  align?: 'left' | 'right' | 'center';
}

/**
 * Maquetador mínimo de informes: lleva el cursor vertical, salta de página
 * cuando no cabe lo siguiente y numera las páginas al terminar.
 */
export class PdfReport {
  readonly margin = 40;
  page!: PDFPage;
  y = 0;

  private constructor(
    readonly pdf: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    private readonly size: [number, number],
    private readonly footerText: string,
  ) {
    this.addPage();
  }

  static async create(opts: { landscape?: boolean; footer: string; title: string }): Promise<PdfReport> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(winAnsi(opts.title));
    pdf.setProducer('HR-Core');
    pdf.setCreationDate(new Date());
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    return new PdfReport(pdf, font, bold, opts.landscape ? [841.89, 595.28] : [595.28, 841.89], winAnsi(opts.footer));
  }

  get width(): number {
    return this.size[0] - this.margin * 2;
  }

  /**
   * Marca del cliente en la esquina superior derecha de la primera página: su
   * logotipo (PNG o JPEG, hasta 120 × 40 pt) y, debajo, su nombre comercial.
   */
  async brand(b: { name: string | null; logo: Buffer | null } | undefined): Promise<void> {
    if (!b || (!b.name && !b.logo)) return;
    const right = this.size[0] - this.margin;
    let top = this.size[1] - this.margin;
    if (b.logo) {
      try {
        const img = b.logo[0] === 0x89 ? await this.pdf.embedPng(b.logo) : await this.pdf.embedJpg(b.logo);
        const scale = Math.min(120 / img.width, 40 / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        this.page.drawImage(img, { x: right - w, y: top - h, width: w, height: h });
        top -= h + 4;
      } catch {
        /* un logotipo dañado no impide el informe */
      }
    }
    if (b.name) {
      const name = winAnsi(b.name);
      const w = this.bold.widthOfTextAtSize(name, 9);
      this.page.drawText(name, { x: right - w, y: top - 9, size: 9, font: this.bold, color: MUTED });
    }
  }

  addPage(): void {
    this.page = this.pdf.addPage(this.size);
    this.y = this.size[1] - this.margin;
  }

  /** Garantiza `height` puntos libres; si no los hay, pasa a una página nueva. */
  ensure(height: number): void {
    if (this.y - height < this.margin + 24) this.addPage();
  }

  gap(points: number): void {
    this.y -= points;
  }

  wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    // Primero se parte por saltos de línea: winAnsi los trataría como caracteres no imprimibles.
    for (const paragraph of text.split('\n').map(winAnsi)) {
      let line = '';
      for (const word of paragraph.split(/(?<=\s)|(?<=[/;,·])/)) {
        let piece = word;
        while (font.widthOfTextAtSize(piece, size) > maxWidth && piece.length > 1) {
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
      lines.push(line.trimEnd());
    }
    return lines;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; maxWidth?: number; lineGap?: number } = {}): void {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? this.margin;
    const lines = this.wrap(text, font, size, opts.maxWidth ?? this.width - (x - this.margin));
    for (const line of lines) {
      this.ensure(size + 4);
      this.y -= size;
      this.page.drawText(line, { x, y: this.y, size, font, color: opts.color ?? INK });
      this.y -= opts.lineGap ?? 4;
    }
  }

  /** Pares etiqueta/valor en dos columnas, para la cabecera del informe. */
  facts(rows: [string, string][], columns = 2): void {
    const colWidth = this.width / columns;
    const rowHeight = 28;
    for (let i = 0; i < rows.length; i += columns) {
      this.ensure(rowHeight);
      this.y -= rowHeight;
      rows.slice(i, i + columns).forEach(([label, value], c) => {
        const x = this.margin + c * colWidth;
        this.page.drawText(winAnsi(label.toUpperCase()), { x, y: this.y + 15, size: 6.5, font: this.bold, color: MUTED });
        const fitted = this.wrap(value || '—', this.font, 10, colWidth - 10)[0] ?? '';
        this.page.drawText(fitted, { x, y: this.y + 3, size: 10, font: this.font, color: INK });
      });
    }
    this.gap(6);
  }

  rule(): void {
    this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.margin + this.width, y: this.y }, thickness: 0.6, color: LINE });
  }

  /** Tabla con cabecera repetida en cada página y celdas que envuelven texto. */
  table(columns: Column[], rows: string[][], opts: { size?: number; emphasizeLast?: boolean; shade?: (rowIndex: number) => boolean; rowPad?: number } = {}): void {
    const size = opts.size ?? 8;
    const rowPad = opts.rowPad ?? 7;
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const pad = 4;

    const header = (): void => {
      this.ensure(22);
      this.y -= 18;
      this.page.drawRectangle({ x: this.margin, y: this.y, width: this.width, height: 18, color: INK });
      let x = this.margin;
      columns.forEach((c, i) => {
        const label = winAnsi(c.header);
        const w = this.bold.widthOfTextAtSize(label, 7);
        const tx = c.align === 'right' ? x + widths[i]! - pad - w : c.align === 'center' ? x + (widths[i]! - w) / 2 : x + pad;
        this.page.drawText(label, { x: tx, y: this.y + 6, size: 7, font: this.bold, color: rgb(1, 1, 1) });
        x += widths[i]!;
      });
    };
    header();

    rows.forEach((row, r) => {
      const last = opts.emphasizeLast && r === rows.length - 1;
      const font = last ? this.bold : this.font;
      const cells = row.map((cell, i) => this.wrap(cell, font, size, widths[i]! - pad * 2));
      const height = Math.max(...cells.map((c) => c.length)) * (size + 2.5) + rowPad;
      if (this.y - height < this.margin + 24) {
        this.addPage();
        header();
      }
      this.y -= height;
      if (last || opts.shade?.(r)) this.page.drawRectangle({ x: this.margin, y: this.y, width: this.width, height, color: SOFT });
      let x = this.margin;
      cells.forEach((lines, i) => {
        lines.forEach((line, l) => {
          const w = font.widthOfTextAtSize(line, size);
          const align = columns[i]!.align;
          const tx = align === 'right' ? x + widths[i]! - pad - w : align === 'center' ? x + (widths[i]! - w) / 2 : x + pad;
          this.page.drawText(line, { x: tx, y: this.y + height - (rowPad / 2 + 1.5) - size - l * (size + 2.5), size, font, color: INK });
        });
        x += widths[i]!;
      });
      this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.margin + this.width, y: this.y }, thickness: 0.4, color: LINE });
    });
    this.gap(10);
  }

  /** Dos recuadros de firma, uno junto a otro. */
  signatures(left: string, right: string): void {
    this.ensure(86);
    const w = (this.width - 20) / 2;
    this.y -= 70;
    [left, right].forEach((label, i) => {
      const x = this.margin + i * (w + 20);
      this.page.drawRectangle({ x, y: this.y, width: w, height: 58, borderColor: LINE, borderWidth: 0.8 });
      this.page.drawText(winAnsi(label), { x: x + 6, y: this.y + 47, size: 7.5, font: this.bold, color: MUTED });
    });
    this.gap(10);
  }

  /** Cuadrícula de imágenes con pie, para los anexos de fotos. */
  async gallery(items: { image: Buffer; caption: string }[], perRow = 2, cellHeight = 330): Promise<void> {
    const gapX = 14;
    const cellW = (this.width - gapX * (perRow - 1)) / perRow;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(cellHeight + 30);
      const top = this.y;
      for (const [c, item] of items.slice(i, i + perRow).entries()) {
        const x = this.margin + c * (cellW + gapX);
        let img: PDFImage | null = null;
        try {
          img = await this.pdf.embedJpg(item.image);
        } catch {
          img = await this.pdf.embedPng(item.image).catch(() => null);
        }
        this.page.drawRectangle({ x, y: top - cellHeight, width: cellW, height: cellHeight, borderColor: LINE, borderWidth: 0.6, color: SOFT });
        if (img) {
          // Nunca se amplía por encima del tamaño real: una imagen pequeña no se convierte en un borrón.
          const scale = Math.min((cellW - 8) / img.width, (cellHeight - 8) / img.height, 1);
          this.page.drawImage(img, {
            x: x + (cellW - img.width * scale) / 2,
            y: top - cellHeight + (cellHeight - img.height * scale) / 2,
            width: img.width * scale,
            height: img.height * scale,
          });
        } else {
          this.page.drawText(winAnsi('Imagen no incrustable'), { x: x + 10, y: top - cellHeight / 2, size: 8, font: this.font, color: MUTED });
        }
        this.wrap(item.caption, this.font, 7.5, cellW)
          .slice(0, 2)
          .forEach((line, l) => this.page.drawText(line, { x, y: top - cellHeight - 11 - l * 10, size: 7.5, font: this.font, color: MUTED }));
      }
      this.y = top - cellHeight - 30;
    }
  }

  async finish(): Promise<Buffer> {
    const pages = this.pdf.getPages();
    pages.forEach((page, i) => {
      const { width } = page.getSize();
      page.drawText(this.footerText, { x: this.margin, y: 22, size: 6.5, font: this.font, color: MUTED });
      const label = `${i + 1} / ${pages.length}`;
      page.drawText(label, { x: width - this.margin - this.font.widthOfTextAtSize(label, 7), y: 22, size: 7, font: this.font, color: MUTED });
    });
    return Buffer.from(await this.pdf.save());
  }
}
