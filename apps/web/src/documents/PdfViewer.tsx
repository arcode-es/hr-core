import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '../ui/Spinner';

/**
 * Visor de PDF propio (pdf.js): los navegadores móviles no muestran PDFs
 * incrustados de forma fiable. Se carga bajo demanda porque pesa.
 */
export function PdfViewer({ data }: { data: ArrayBuffer }) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const container = host.current;
    if (!container) return;
    setState('loading');
    container.replaceChildren();

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        // pdf.js se queda con el buffer: se le pasa una copia para poder reutilizar el original.
        const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise;
        if (cancelled) return;
        setPages(pdf.numPages);
        const width = container.clientWidth;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'edge mb-3 block w-full rounded-xl bg-white shadow-card';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', t('documents.pageOf', { page: n, total: pdf.numPages }));
          container.appendChild(canvas);
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
          if (n === 1 && !cancelled) setState('ready');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, t]);

  return (
    <div>
      {state === 'loading' && (
        <div className="flex h-64 items-center justify-center text-fg-subtle">
          <Spinner className="size-7" />
        </div>
      )}
      {state === 'error' && <p className="rounded-2xl bg-surface-2 py-10 text-center text-sm text-fg-muted">{t('documents.viewerError')}</p>}
      <div ref={host} data-pages={pages} />
    </div>
  );
}
