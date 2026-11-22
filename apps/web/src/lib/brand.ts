import type { Branding } from '@hr/shared';

/**
 * Nombre del producto en esta instalación. En la imagen Docker lo fija el contenedor al arrancar
 * (APP_NAME → /config.js); al compilar a mano, VITE_APP_NAME.
 */
const runtimeName = (globalThis as { __HR_CONFIG__?: { appName?: string } }).__HR_CONFIG__?.appName;
export const APP_NAME: string = runtimeName || import.meta.env.VITE_APP_NAME || 'HR-Core';

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Luminancia relativa (WCAG 2). */
function luminance([r, g, b]: Rgb): number {
  const ch = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Oscurece (hacia negro) o aclara (hacia blanco) el color hasta llegar al contraste pedido frente a `against`. */
function untilContrast(hex: string, against: string, ratio: number, towards: 'black' | 'white'): string {
  const target: Rgb = towards === 'black' ? [0, 0, 0] : [255, 255, 255];
  let c = hex;
  for (let i = 0; i <= 20 && contrast(c, against) < ratio; i++) c = toHex(mix(toRgb(hex), target, i * 0.05));
  return c;
}

const WHITE = '#ffffff';
const DARK_SURFACE = '#121722';

/**
 * Tonos del acento de la marca para los temas claro y oscuro, siempre con contraste
 * AA (4,5:1): texto blanco sobre el acento y el acento como texto sobre el fondo.
 * El tema «Sol» (contraste máximo) no se toca.
 */
export function accentTokens(hex: string): { light: Record<string, string>; dark: Record<string, string> } {
  const accent = untilContrast(hex, WHITE, 4.5, 'black');
  // El texto del acento se usa sobre el fondo y sobre su versión suave (menú activo, avisos):
  // se calcula contra la suave, que es la más exigente.
  const lightSoft = toHex(mix(toRgb(hex), [255, 255, 255], 0.9));
  const darkSoft = toHex(mix(toRgb(hex), toRgb(DARK_SURFACE), 0.8));
  const light = {
    '--accent': accent,
    '--accent-hover': toHex(mix(toRgb(accent), [0, 0, 0], 0.15)),
    '--accent-fg': WHITE,
    '--accent-text': untilContrast(accent, lightSoft, 4.5, 'black'),
    '--accent-soft': lightSoft,
  };
  const dark = {
    '--accent': accent,
    '--accent-hover': toHex(mix(toRgb(accent), [255, 255, 255], 0.12)),
    '--accent-fg': WHITE,
    '--accent-text': untilContrast(hex, darkSoft, 4.5, 'white'),
    '--accent-soft': darkSoft,
  };
  return { light, dark };
}

const STYLE_ID = 'brand-accent';

/** Aplica (o quita) el color de la empresa activa. */
export function applyBrand(branding: Branding | undefined): void {
  const current = document.getElementById(STYLE_ID);
  const hex = branding?.accent;
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    current?.remove();
    return;
  }
  const { light, dark } = accentTokens(hex);
  const block = (vars: Record<string, string>): string => Object.entries(vars).map(([k, v]) => `${k}:${v};`).join('');
  const css = `html:not([data-theme]),html[data-theme='light']{${block(light)}}html[data-theme='dark']{${block(dark)}}`;
  const el = current ?? Object.assign(document.createElement('style'), { id: STYLE_ID });
  el.textContent = css;
  if (!current) document.head.append(el);
}
