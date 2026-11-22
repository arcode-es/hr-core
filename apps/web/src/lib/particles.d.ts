export interface ParticleOptions {
  shapes?: ('dome' | 'fountain' | 'ring' | 'cylinder' | 'sphere')[];
  rows?: number;
  cols?: number;
  color?: [number, number, number];
  tilt?: number;
  speed?: number;
  centerY?: number | number[];
  scale?: number;
}
export function createParticles(canvas: HTMLCanvasElement, options?: ParticleOptions): { setProgress(p: number): void; destroy(): void };
