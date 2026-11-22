// Nube de partículas del sistema de diseño: trazos luminosos sobre una forma en 3D que gira despacio
// y puede pasar de una forma a otra. Sin dependencias; el mismo archivo lo usan la app y la landing.

const TAU = Math.PI * 2;

/** Cada forma coloca el punto (u, v) ∈ [0,1)² en el espacio; `du` desplaza u para trazar el guion. */
const SHAPES = {
  // Cúpula: media esfera que asoma desde abajo.
  dome: (u, v) => {
    const phi = (0.08 + v * 0.92) * (Math.PI / 2);
    return [Math.cos(u * TAU) * Math.sin(phi) * 1.45, 0.95 - Math.cos(phi) * 1.45, Math.sin(u * TAU) * Math.sin(phi) * 1.45];
  },
  // Surtidor: un cono que se abre hacia abajo.
  fountain: (u, v) => {
    const r = 0.06 + Math.pow(v, 1.7) * 1.25;
    return [Math.cos(u * TAU) * r, -0.75 + v * 1.25, Math.sin(u * TAU) * r];
  },
  // Anillo: un toro visto casi de frente.
  ring: (u, v) => {
    const a = v * TAU;
    const r = 1.05 + Math.cos(a) * 0.2;
    return [Math.cos(u * TAU) * r, Math.sin(a) * 0.2, Math.sin(u * TAU) * r];
  },
  // Cilindro: una columna de anillos.
  cylinder: (u, v) => [Math.cos(u * TAU) * 0.72, (v - 0.5) * 2.1, Math.sin(u * TAU) * 0.72],
  // Esfera completa.
  sphere: (u, v) => {
    const phi = (0.04 + v * 0.92) * Math.PI;
    return [Math.cos(u * TAU) * Math.sin(phi) * 1.05, -Math.cos(phi) * 1.05, Math.sin(u * TAU) * Math.sin(phi) * 1.05];
  },
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ shapes?: string[], rows?: number, cols?: number, color?: [number, number, number], tilt?: number, speed?: number, centerY?: number | number[], scale?: number }} [options]
 *   `centerY` puede ser una lista, con la altura (0–1) de cada forma.
 * @returns {{ setProgress(p: number): void, destroy(): void }}
 */
export function createParticles(canvas, options = {}) {
  const shapes = (options.shapes ?? ['dome']).map((name) => SHAPES[name] ?? SHAPES.dome);
  const rows = options.rows ?? 34;
  const cols = options.cols ?? 54;
  const [cr, cg, cb] = options.color ?? [53, 170, 255];
  const tilt = options.tilt ?? 0.32;
  const speed = options.speed ?? 0.05;
  const centers = shapes.map((_, n) => (Array.isArray(options.centerY) ? (options.centerY[n] ?? 0.5) : (options.centerY ?? 0.5)));
  let centerY = centers[0];
  const ctx = canvas.getContext('2d');
  if (!ctx) return { setProgress() {}, destroy() {} };

  // Una rejilla por filas (paralelos) con un pequeño desorden: de ahí salen las líneas de trazos.
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const seed = Math.sin(r * 127.1 + c * 311.7) * 43758.5453;
      const rnd = seed - Math.floor(seed);
      points.push({ u: (c + (r % 2) * 0.5 + (rnd - 0.5) * 0.35) / cols, v: (r + 0.5) / rows, phase: rnd * TAU, len: 0.006 + rnd * 0.012, skip: rnd > 0.86 });
    }
  }

  let progress = 0;
  let shown = 0;
  let width = 0;
  let height = 0;
  let raf = 0;
  let running = true;
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function project(p, rot, a, b, mix, du) {
    const pa = a(p.u + du, p.v);
    const pb = mix > 0 ? b(p.u + du, p.v) : pa;
    let x = pa[0] + (pb[0] - pa[0]) * mix;
    let y = pa[1] + (pb[1] - pa[1]) * mix;
    let z = pa[2] + (pb[2] - pa[2]) * mix;
    const cx = Math.cos(rot);
    const sx = Math.sin(rot);
    [x, z] = [x * cx - z * sx, x * sx + z * cx];
    [y, z] = [y * ct - z * st, y * st + z * ct];
    const k = 2.6 / (2.6 + z);
    const unit = Math.min(width, height * 1.5) * 0.34 * (options.scale ?? 1);
    return [width / 2 + x * unit * k, height * centerY + y * unit * k, z];
  }

  function frame(time) {
    // El avance sigue al objetivo con suavidad: al hacer scroll la forma no salta.
    shown += (progress - shown) * (still ? 1 : 0.08);
    const i = Math.min(shapes.length - 1, Math.max(0, Math.floor(shown)));
    const j = Math.min(shapes.length - 1, i + 1);
    const f = shown - i;
    const mix = f * f * (3 - 2 * f);
    centerY = centers[i] + (centers[j] - centers[i]) * mix;
    const rot = still ? 0.6 : time * 0.001 * speed * TAU;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of points) {
      if (p.skip) continue;
      const [x1, y1, z] = project(p, rot, shapes[i], shapes[j], mix, 0);
      const [x2, y2] = project(p, rot, shapes[i], shapes[j], mix, p.len);
      // Lo que queda detrás se atenúa; cada trazo parpadea a su ritmo.
      const depth = Math.min(1, Math.max(0, (1.35 - z) / 2.4));
      const flicker = still ? 0.8 : 0.55 + 0.45 * Math.sin(time * 0.0016 + p.phase);
      const alpha = depth * depth * flicker;
      if (alpha < 0.03) continue;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(alpha * 0.22).toFixed(3)})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${Math.min(255, cr + 120)},${Math.min(255, cg + 60)},255,${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    if (running && !still) raf = requestAnimationFrame(frame);
  }

  const onResize = () => {
    resize();
    if (still) frame(0);
  };
  // Fuera de pantalla no se dibuja: ni batería ni CPU.
  const observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
          const visible = entry?.isIntersecting ?? true;
          if (visible && !running) {
            running = true;
            if (!still) raf = requestAnimationFrame(frame);
          } else if (!visible) {
            running = false;
            cancelAnimationFrame(raf);
          }
        })
      : null;
  observer?.observe(canvas);
  window.addEventListener('resize', onResize);
  resize();
  if (still) frame(0);
  else raf = requestAnimationFrame(frame);

  return {
    setProgress(p) {
      progress = Math.min(shapes.length - 1, Math.max(0, p));
      if (still) frame(0);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
    },
  };
}
