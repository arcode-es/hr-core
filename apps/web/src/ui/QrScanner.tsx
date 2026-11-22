import { CameraOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from './Sheet';
import { Spinner } from './Spinner';

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/** Lector nativo (Chrome en Android, Safari reciente) o, si no lo hay, jsQR sobre cada fotograma. */
async function createDetector(): Promise<(video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>> {
  const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  if (Native) {
    try {
      const detector = new Native({ formats: ['qr_code'] });
      return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
    } catch {
      /* sin soporte para QR: se usa jsQR */
    }
  }
  const { default: jsQR } = await import('jsqr');
  return async (video, canvas) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    // Basta con una imagen reducida: el QR ocupa buena parte del encuadre.
    const scale = Math.min(1, 640 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(data.data, data.width, data.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

/**
 * Hoja con la cámara abierta que lee un código QR. Llama a `onResult` con el texto
 * del primer código que encuentra; quien lo usa decide si le vale.
 */
export function QrScanner({
  open,
  onClose,
  onResult,
  title,
  facing = 'environment',
}: {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
  title?: string;
  facing?: 'environment' | 'user';
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'denied' | 'unavailable'>('starting');
  const result = useRef(onResult);
  result.current = onResult;

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    setState('starting');
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
      } catch (e) {
        setState(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'unavailable');
        return;
      }
      if (stopped || !video.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      setState('scanning');
      const detect = await createDetector();
      const loop = async (): Promise<void> => {
        if (stopped || !video.current || !canvas.current) return;
        const text = await detect(video.current, canvas.current).catch(() => null);
        if (stopped) return;
        if (text) {
          navigator.vibrate?.(30);
          result.current(text);
          return;
        }
        timer = window.setTimeout(() => void loop(), 220);
      };
      void loop();
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, facing]);

  return (
    <Sheet open={open} onClose={onClose} title={title ?? t('scanner.title')} description={t('scanner.hint')}>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
        <video ref={video} playsInline muted className="size-full object-cover" aria-hidden="true" />
        <canvas ref={canvas} className="hidden" />
        {state === 'scanning' && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-3xl border-4 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        )}
        {state === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <Spinner className="size-8" />
          </div>
        )}
        {(state === 'denied' || state === 'unavailable') && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            <CameraOff className="size-9" />
            <p className="text-sm font-medium">{t(`scanner.${state}`)}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
