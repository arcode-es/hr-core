import { Eraser } from 'lucide-react';
import { forwardRef, type PointerEvent, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SignatureResult {
  signature: string;
  strokes: number;
  points: number;
}

export interface SignaturePadHandle {
  /** null si aún no hay una firma suficiente. */
  result: () => SignatureResult | null;
  clear: () => void;
}

type Point = { x: number; y: number };
const EXPORT_W = 600;
const EXPORT_H = 240;
const MIN_POINTS = 12;

function draw(ctx: CanvasRenderingContext2D, strokes: Point[][], scaleX: number, scaleY: number, lineWidth: number, color: string): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0]!.x * scaleX, s[0]!.y * scaleY, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(s[0]!.x * scaleX, s[0]!.y * scaleY);
    // Curvas entre puntos medios: el trazo sale suave aunque el dedo dé pocos puntos.
    for (let i = 1; i < s.length - 1; i++) {
      const mx = ((s[i]!.x + s[i + 1]!.x) / 2) * scaleX;
      const my = ((s[i]!.y + s[i + 1]!.y) / 2) * scaleY;
      ctx.quadraticCurveTo(s[i]!.x * scaleX, s[i]!.y * scaleY, mx, my);
    }
    const last = s[s.length - 1]!;
    ctx.lineTo(last.x * scaleX, last.y * scaleY);
    ctx.stroke();
  }
}

/** Lienzo para firmar con el dedo, el lápiz o el ratón. */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (hasInk: boolean) => void }>(function SignaturePad({ onChange }, ref) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const count = (): number => strokes.current.reduce((n, s) => n + s.length, 0);

  const repaint = (): void => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    if (c.width !== Math.round(rect.width * ratio)) {
      c.width = Math.round(rect.width * ratio);
      c.height = Math.round(rect.height * ratio);
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    // Los puntos se guardan normalizados (0–1): la firma sobrevive a girar el móvil.
    draw(ctx, strokes.current, c.width, c.height, 2.6 * ratio, getComputedStyle(c).color);
  };

  useEffect(() => {
    repaint();
    const ro = new ResizeObserver(repaint);
    if (canvas.current) ro.observe(canvas.current);
    return () => ro.disconnect();
  }, []);

  const point = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const notify = (): void => {
    const has = count() >= MIN_POINTS;
    setEmpty(strokes.current.length === 0);
    onChange?.(has);
  };

  const clear = (): void => {
    strokes.current = [];
    repaint();
    notify();
  };

  useImperativeHandle(ref, () => ({
    clear,
    result: () => {
      const points = count();
      if (points < MIN_POINTS) return null;
      const out = document.createElement('canvas');
      out.width = EXPORT_W;
      out.height = EXPORT_H;
      // Tinta oscura sobre transparente, a tamaño fijo: independiente del tema y de la pantalla.
      draw(out.getContext('2d')!, strokes.current, EXPORT_W, EXPORT_H, 3.2, '#0f1524');
      return { signature: out.toDataURL('image/png'), strokes: strokes.current.length, points };
    },
  }));

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvas}
          role="img"
          aria-label={t('documents.padLabel')}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drawing.current = true;
            strokes.current.push([point(e)]);
            repaint();
            notify();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            strokes.current[strokes.current.length - 1]!.push(point(e));
            repaint();
          }}
          onPointerUp={() => {
            drawing.current = false;
            notify();
          }}
          onPointerCancel={() => {
            drawing.current = false;
            notify();
          }}
          // touch-action: none — dibujar no debe desplazar la página.
          className="edge block h-52 w-full touch-none rounded-2xl bg-surface-2/60 text-fg"
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 bottom-12 border-b-2 border-dashed border-border-strong" />
        {empty && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-fg-subtle">
            {t('documents.padHint')}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={empty}
        className="focus-ring mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-fg-muted hover:text-fg disabled:opacity-40"
      >
        <Eraser className="size-4" />
        {t('documents.padClear')}
      </button>
    </div>
  );
});
