import { expect, test } from '@playwright/test';
import { apiCall, company, failOnPageErrors, person, phone, register, samplePhoto } from './helpers';

const SITE = { latitude: 39.4699, longitude: -0.3763 };

test('fichar con GPS: dentro del perímetro, pausa, fuera del perímetro y foto', async ({ browser }) => {
  const c = await company(browser, { geolocation: { ...SITE, accuracy: 9 }, permissions: ['geolocation'] });
  await apiCall(c.boss, 'POST', '/locations', { name: 'Obra Ayuntamiento', ...SITE, geofenceRadiusMeters: 100 }, c.orgId);
  const m = c.worker;

  await m.goto('/clock');
  await expect(m.getByText('Estás en Obra Ayuntamiento')).toBeVisible({ timeout: 20_000 });
  await m.locator('input[type=file]').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await samplePhoto(m) });
  await expect(m.getByText('Foto lista')).toBeVisible();
  await m.getByRole('button', { name: 'Iniciar jornada' }).click();
  await expect(m.getByText('Trabajando')).toBeVisible();
  await expect(m.getByRole('button', { name: 'Foto entrada' })).toBeVisible();

  await m.getByRole('button', { name: 'Pausa' }).click();
  await m.getByRole('button', { name: /Comida/ }).click();
  await expect(m.getByRole('button', { name: 'Reanudar' })).toBeVisible();
  await m.getByRole('button', { name: 'Reanudar' }).click();
  await expect(m.getByText('De vuelta al trabajo')).toBeVisible();

  // Se aleja unos 500 m: se le deja fichar, pero queda señalado.
  await c.workerContext.setGeolocation({ latitude: SITE.latitude + 0.0046, longitude: SITE.longitude, accuracy: 12 });
  await expect(m.getByText('Fuera de perímetro').first()).toBeVisible({ timeout: 20_000 });
  await m.getByRole('button', { name: 'Pausa' }).click();
  await m.getByRole('button', { name: /Desplazamiento/ }).click();
  await m.getByRole('button', { name: 'Reanudar' }).click();
  await expect(m.getByText(/A \d+ m de Obra Ayuntamiento/).first()).toBeVisible();

  await m.getByRole('button', { name: 'Finalizar' }).click();
  await m.getByRole('button', { name: 'Finalizar jornada' }).click();
  await expect(m.getByText('Listo para empezar')).toBeVisible();

  // La foto se guarda sellada y se puede volver a ver.
  await m.getByRole('button', { expanded: false }).filter({ hasText: /min/ }).first().click();
  await m.getByRole('button', { name: 'Foto entrada' }).click();
  await expect.poll(() => m.evaluate(() => (document.querySelector('dialog[open] img') as HTMLImageElement | null)?.naturalWidth ?? 0)).toBeGreaterThan(0);

  // La responsable lo ve en el equipo del día, con el aviso de ubicación.
  await c.boss.goto('/timesheets');
  await c.boss.getByRole('button', { name: /Luis Peña Soler/ }).click();
  await expect(c.boss.getByText(/A \d+ m de Obra Ayuntamiento/).first()).toBeVisible();
});

test('sin permiso de ubicación se puede fichar igualmente y queda indicado', async ({ browser }) => {
  const page = await (await browser.newContext(phone)).newPage();
  failOnPageErrors(page);
  await register(page, person('Paco Sin Gps'));
  await expect(page.getByRole('heading', { name: /Paco/ })).toBeVisible();
  await page.goto('/clock');
  await expect(page.getByText(/Ubicación desactivada|Sin señal GPS/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Iniciar jornada' }).click();
  await expect(page.getByText('Trabajando')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Sin ubicación', { exact: true })).toBeVisible();
  // El inicio muestra el cronómetro en vivo.
  await page.goto('/');
  await expect(page.getByText(/Trabajando · Desde/)).toBeVisible();
});
