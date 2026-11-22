import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/** Ejecuta axe-core en la página y devuelve una línea por incidencia WCAG 2 A/AA. */
export default async function audit(page: Page): Promise<string[]> {
  await page.evaluate(source);
  return page.evaluate(async () => {
    // @ts-expect-error axe se inyecta en la página
    const result = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
    return result.violations.map(
      (v: { id: string; impact: string; nodes: { target: string[] }[] }) => `[${v.impact}] ${v.id} ×${v.nodes.length} — ${v.nodes[0]!.target.join(' ')}`,
    );
  });
}
