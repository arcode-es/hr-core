import { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';
import { createParticles, type ParticleOptions } from '../lib/particles';

/** Nube de partículas decorativa del sistema de diseño. No aporta información: va oculta a lectores de pantalla. */
export function Particles({ className, ...options }: ParticleOptions & { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(options);
  useEffect(() => {
    if (!ref.current) return;
    const particles = createParticles(ref.current, JSON.parse(key) as ParticleOptions);
    return () => particles.destroy();
  }, [key]);
  return <canvas ref={ref} aria-hidden="true" className={cn('pointer-events-none absolute inset-0 size-full', className)} />;
}
