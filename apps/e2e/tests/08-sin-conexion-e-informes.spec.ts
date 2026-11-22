import { expect, test } from '@playwright/test';
import { apiCall, failOnPageErrors, person, phone, register } from './helpers';

test('sin conexión: fichar, reabrir la app, guardar un gasto y sincronizar sin duplicados', async ({ browser }) => {
  const context = await browser.newContext({ ...phone, geolocation: { latitude: 39.4699, longitude: -0.3763, accuracy: 15 }, permissions: ['geolocation'] });
  const m = await context.newPage();
  failOnPageErrors(m);
  await register(m, person('Sin Cobertura'));
  await expect(m.getByRole('heading', { name: /Sin/ })).toBeVisible();
  await m.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // Con red se visitan una vez las pantallas: quedan en caché y se guarda su configuración.
  await m.goto('/expenses');
  await expect(m.getByText('Sin gastos este mes')).toBeVisible();
  await m.goto('/clock');
  await expect(m.getByText('Posición lista')).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  await expect(m.getByText(/Sin conexión\. Puedes fichar/)).toBeVisible();
  await m.getByRole('button', { name: 'Iniciar jornada' }).click();
  await expect(m.getByText('Sin conexión: fichaje guardado en el móvil')).toBeVisible();
  await m.getByRole('button', { name: 'Pausa' }).click();
  await m.getByRole('button', { name: /Comida/ }).click();
  await m.getByRole('button', { name: 'Reanudar' }).click();
  await expect(m.getByText('Sin conexión · 3 acciones guardadas en el móvil')).toBeVisible();

  // Cerrar y reabrir sin red: sigue dentro y con la jornada tal como estaba.
  await m.reload();
  await expect(m.getByText('Trabajando')).toBeVisible({ timeout: 20_000 });
  await expect(m.getByText('Pendiente de enviar').first()).toBeVisible();

  await m.getByRole('link', { name: 'Gastos' }).click();
  await m.getByRole('button', { name: 'Sin ticket' }).click();
  await m.getByLabel(/Importe total/).fill('12,50');
  await m.getByLabel('Comercio').fill('Bar La Estación');
  await m.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(m.getByText('Sin conexión: gasto guardado en el móvil')).toBeVisible();

  await m.getByRole('link', { name: 'Fichar' }).click();
  await m.getByRole('button', { name: 'Finalizar' }).click();
  await m.getByRole('button', { name: 'Finalizar jornada' }).click();
  await expect(m.getByText('Sin conexión · 5 acciones guardadas en el móvil')).toBeVisible();

  await context.setOffline(false);
  await expect(m.getByText(/Sin conexión|pendiente|Enviando/)).toHaveCount(0, { timeout: 30_000 });

  const days = await apiCall<{ segments: { entryType: string; syncedOffline: boolean; hasPosition: boolean }[]; endedAt: string | null }[]>(m, 'GET', '/time/workdays');
  expect(days).toHaveLength(1);
  expect(days[0]!.endedAt).not.toBeNull();
  expect(days[0]!.segments.map((s) => `${s.entryType}:${s.syncedOffline}:${s.hasPosition}`)).toEqual(['WORK:true:true', 'BREAK:true:true', 'WORK:true:true']);
  const month = new Date().toISOString().slice(0, 7);
  const expenses = await apiCall<{ merchantName: string }[]>(m, 'GET', `/expenses?from=${month}-01&to=${month}-28`);
  expect(expenses.map((e) => e.merchantName)).toEqual(['Bar La Estación']);
  await m.reload();
  await m.getByRole('button', { expanded: false }).filter({ hasText: /min/ }).first().click();
  await expect(m.getByText('Registrado sin conexión').first()).toBeVisible();
});

test('informes: descarga en PDF, Excel y CSV con nombre de archivo', async ({ browser }) => {
  const page = await (await browser.newContext(phone)).newPage();
  failOnPageErrors(page);
  await register(page, person('Informe Pérez'));
  await expect(page.getByRole('heading', { name: /Informe/ })).toBeVisible();
  await page.goto('/reports');
  const month = new Date().toISOString().slice(0, 7);
  for (const [report, format, ext] of [
    ['Registro de jornada', 'PDF', 'pdf'],
    ['Registro de jornada', 'Excel', 'xlsx'],
    ['Informe detallado con ubicaciones', 'PDF', 'pdf'],
    ['Liquidación de gastos y dietas', 'CSV', 'csv'],
  ] as const) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: `Descargar ${report} en ${format}` }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`-${month}-informe-perez\\.${ext}$`));
  }
});
