const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** Quita espacios, puntos y guiones y pasa a mayúsculas: «12.345.678-z» → «12345678Z». */
export const normalizeDni = (s: string): string => s.toUpperCase().replace(/[\s.-]/g, '');

/** DNI (8 cifras y letra) o NIE (X/Y/Z, 7 cifras y letra) con la letra de control correcta. */
export function validDniNie(raw: string): boolean {
  const s = normalizeDni(raw);
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(s);
  if (!m) return false;
  const [, prefix, digits, letter] = m as unknown as [string, string, string, string];
  if (prefix ? digits.length !== 7 : digits.length !== 8) return false;
  const number = Number(`${prefix ? 'XYZ'.indexOf(prefix) : ''}${digits}`);
  return LETTERS[number % 23] === letter;
}

/**
 * DNI/NIE que aparecen en un texto (una página de nómina), ya normalizados y
 * solo los que tienen la letra de control correcta: así no se confunden con
 * otros números (cuentas, afiliación a la Seguridad Social...).
 */
export function findDnis(text: string): string[] {
  const found = new Set<string>();
  const re = /\b([XYZ][\s.-]?\d{7}|\d{2}[.]?\d{3}[.]?\d{3})[\s-]?([A-Za-z])\b/g;
  for (const m of text.matchAll(re)) {
    const candidate = normalizeDni(`${m[1]}${m[2]}`);
    if (validDniNie(candidate)) found.add(candidate);
  }
  return [...found];
}
