import { PDFDocument } from 'pdf-lib';
import { assertSignable, documentKind, StampData, stampSignature, UnsignableDocumentError } from './signing';

// PNG 1×1 transparente.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const data: StampData = {
  title: 'Nómina de octubre — Peña Soler',
  signerName: 'Luis Peña Soler',
  signerDni: '12345678Z',
  signedAtLocal: '11/11/2026 09:32 (Europe/Madrid)',
  signedAtUtc: '2026-11-11T08:32:10.000Z',
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  originalSha256: 'a'.repeat(64),
  originalFileName: 'nomina-2026-10.pdf',
};

async function samplePdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([595, 842]).drawText(`Página ${i + 1}`, { x: 50, y: 780 });
  return Buffer.from(await pdf.save());
}

describe('documentKind', () => {
  it('reconoce PDF, JPEG y PNG por su cabecera', async () => {
    expect(documentKind(await samplePdf(1))).toBe('pdf');
    expect(documentKind(PNG)).toBe('png');
    expect(documentKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpg');
  });
  it('rechaza lo demás, aunque se llame .pdf', () => {
    expect(documentKind(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(documentKind(Buffer.from('PK\x03\x04 un zip'))).toBeNull();
  });
});

describe('stampSignature', () => {
  it('conserva las páginas originales y añade una de certificado', async () => {
    const signed = await stampSignature(await samplePdf(3), 'pdf', PNG, data);
    const pdf = await PDFDocument.load(signed);
    expect(pdf.getPageCount()).toBe(4);
    expect(pdf.getSubject()).toContain('Luis Peña Soler (12345678Z)');
    expect(pdf.getKeywords()).toContain(`sha256:${data.originalSha256}`);
    expect(documentKind(signed)).toBe('pdf');
  });

  it('convierte una imagen en PDF antes de firmarla', async () => {
    const signed = await stampSignature(PNG, 'png', PNG, data);
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(2);
  });

  it('no falla con caracteres fuera del juego básico (emoji, cirílico) ni sin IP', async () => {
    const signed = await stampSignature(await samplePdf(1), 'pdf', PNG, { ...data, title: 'Contrato 📄 Иван — «anexo»', ip: null, userAgent: null });
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(2);
  });

  it('un PDF dañado no es firmable', async () => {
    const broken = Buffer.from('%PDF-1.7\nesto no es un pdf de verdad');
    await expect(assertSignable(broken, 'pdf')).rejects.toBeInstanceOf(UnsignableDocumentError);
    await expect(stampSignature(broken, 'pdf', PNG, data)).rejects.toBeInstanceOf(UnsignableDocumentError);
  });

  it('una firma que no es PNG se rechaza', async () => {
    await expect(stampSignature(await samplePdf(1), 'pdf', Buffer.from('no soy un png'), data)).rejects.toBeInstanceOf(UnsignableDocumentError);
  });
});
