import type { OcrSuggestion } from '@hr/shared';

/**
 * Lectura automática de tickets. Para conectar un servicio real (un modelo de
 * visión, un OCR en la nube o Tesseract):
 *   1. Implementa esta clase en un fichero nuevo.
 *   2. Añade su nombre a `OCR_PROVIDER` en config/env.ts.
 *   3. Regístralo en la factoría de ocr.module.ts.
 * El resto de la aplicación no cambia: la web ya muestra las propuestas.
 */
export abstract class OcrProvider {
  abstract readonly name: string;
  /** Propone los datos del ticket. Los campos que no se puedan leer van a null. */
  abstract extract(image: Buffer, mimeType: string): Promise<OcrSuggestion>;
}

/**
 * Proveedor por defecto: no lee nada y no propone nada. Deliberadamente no
 * inventa importes de ejemplo, porque acabarían guardados como si fueran reales.
 */
export class MockOcrProvider extends OcrProvider {
  readonly name = 'mock';

  extract(): Promise<OcrSuggestion> {
    return Promise.resolve({ provider: this.name, amount: null, taxAmount: null, date: null, merchantName: null, merchantTaxId: null });
  }
}
