import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, DEMO_WEB } from '../playwright.config';
import AxeBuilder from './axe';
import { failOnPageErrors, phone } from './helpers';

/**
 * La demo publicada bajo una ruta: modo demo, ruta base /HR-core,
 * la API detrás del mismo proxy y las cabeceras de seguridad de producción.
 */
test.use({ baseURL: DEMO_WEB });

test('demo: entrar con un clic, la sesión sobrevive a recargar y nada rompe la política de seguridad', async ({ browser }) => {
  const context = await browser.newContext({ ...phone, baseURL: DEMO_WEB });
  const page = await context.newPage();
  failOnPageErrors(page);
  const csp: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/.test(m.text())) csp.push(m.text());
  });

  await page.goto('./');
  await expect(page).toHaveURL(/\/HR-core\/login$/);
  await expect(page.getByRole('note')).toContainText('Estás en la demo de HR-Core');
  await expect(page.getByRole('heading', { name: 'Prueba la demo' })).toBeVisible();
  await expect(page.getByText(`Contraseña de todas las cuentas: ${DEMO_PASSWORD}`)).toBeVisible();
  await page.waitForTimeout(600); // fin de la animación de entrada antes de medir el contraste
  expect(await AxeBuilder(page)).toEqual([]);
  // Sin registro ni recuperación de contraseña.
  await expect(page.getByRole('link', { name: 'Regístrate' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '¿Has olvidado tu contraseña?' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Entrar como Responsable (Javier Ortega Ruiz)' }).click();
  await expect(page.getByRole('heading', { name: /Javier/ })).toBeVisible();
  await expect(page).toHaveURL(/\/HR-core\/$/);
  await expect(page.getByRole('banner').getByText('Construcciones Levante S.L.')).toBeVisible();
  // Una sola empresa y sin poder crear otra: el nombre no abre ningún menú.
  await expect(page.getByRole('button', { name: /Cambiar de espacio/ })).toHaveCount(0);

  // La cookie de sesión vive en /HR-core/api/v1/auth: recargar no saca de la cuenta.
  await page.reload();
  await expect(page.getByRole('heading', { name: /Javier/ })).toBeVisible();

  await page.goto('settings');
  await expect(page.getByText('En la demo no se puede cambiar la contraseña.')).toBeVisible();
  await expect(page.getByText('Este dispositivo', { exact: true })).toBeVisible();

  // El service worker de la app se registra dentro de /HR-core/.
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe('/HR-core/');

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Prueba la demo' })).toBeVisible();
  expect(csp).toEqual([]);
});

test('demo: las cuentas de prueba ven lo que corresponde a su rol', async ({ browser }) => {
  const page = await (await browser.newContext({ ...phone, baseURL: DEMO_WEB })).newPage();
  failOnPageErrors(page);
  await page.goto('login');
  await page.getByRole('button', { name: 'Entrar como Empleado (Luis Peña Gómez)' }).click();
  await expect(page.getByRole('heading', { name: /Luis/ })).toBeVisible();
  await page.goto('documents');
  await expect(page.getByText('Nómina de').first()).toBeVisible();
  await expect(page.getByText('Plan de prevención de riesgos 2026')).toBeVisible();
});

test('demo: no hay registro, ni siquiera entrando directamente a la página', async ({ browser }) => {
  const page = await (await browser.newContext({ ...phone, baseURL: DEMO_WEB })).newPage();
  failOnPageErrors(page);
  await page.goto('register');
  await expect(page.getByRole('heading', { name: 'Solo con invitación' })).toBeVisible();
});
