import { expect, test } from '@playwright/test';
import AxeBuilder from './axe';
import { company, failOnPageErrors, PASSWORD, person, phone, register } from './helpers';

test('textos legales: privacidad, aviso legal y cookies, sin necesidad de cuenta', async ({ browser }) => {
  const page = await (await browser.newContext(phone)).newPage();
  failOnPageErrors(page);
  await page.goto('/login');
  await page.getByRole('link', { name: 'Privacidad' }).click();
  await expect(page.getByRole('heading', { name: 'Política de privacidad', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cuánto tiempo' })).toBeVisible();
  // Sin LEGAL_* configurado, la página lo dice en lugar de inventar datos.
  await expect(page.getByRole('note')).toContainText('Faltan los datos del responsable');
  await page.getByRole('link', { name: 'Aviso legal' }).click();
  await expect(page.getByRole('heading', { name: 'Aviso legal', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Cookies' }).click();
  await expect(page.getByRole('heading', { name: 'Política de cookies', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Volver al acceso' }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible();
});

test('privacidad de la empresa: aviso de geolocalización antes del primer fichaje, con el texto y los plazos de la empresa', async ({ browser }) => {
  const { boss, worker } = await company(browser, {}, { acceptGeoNotice: false });

  await boss.goto('/company');
  await boss.getByLabel('Conservación de las fotos de fichaje').selectOption('6');
  await boss.getByRole('switch', { name: /Horario de desconexión digital/ }).check({ force: true });
  await boss.getByLabel('Desde').fill('21:00');
  await boss.getByLabel('Hasta').fill('07:30');
  await boss.getByLabel('Información adicional sobre la geolocalización').fill('La ubicación solo la consulta Administración.');
  await expect(boss.getByText('Tienes cambios sin guardar')).toBeVisible();
  await boss.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(boss.getByText('Ajustes de empresa guardados')).toBeVisible();
  await boss.reload();
  await expect(boss.getByLabel('Desde')).toHaveValue('21:00');

  await worker.goto('/clock');
  await expect(worker.getByRole('heading', { name: 'Antes de fichar con ubicación' })).toBeVisible();
  await expect(worker.getByText('La ubicación solo la consulta Administración.')).toBeVisible();
  await expect(worker.getByText(/se guardan 6 meses/)).toBeVisible();
  await worker.waitForTimeout(600); // fin de la animación de entrada antes de medir el contraste
  expect(await AxeBuilder(worker)).toEqual([]);
  await worker.getByRole('button', { name: 'Entendido' }).click();
  await expect(worker.getByRole('heading', { name: 'Antes de fichar con ubicación' })).toHaveCount(0);
  await expect(worker.getByRole('button', { name: /Iniciar jornada/ })).toBeVisible();
  // Se pide una sola vez.
  await worker.reload();
  await expect(worker.getByRole('button', { name: /Iniciar jornada/ })).toBeVisible();
  await expect(worker.getByRole('heading', { name: 'Antes de fichar con ubicación' })).toHaveCount(0);
});

test('descargar mis datos en un archivo', async ({ browser }) => {
  const { worker } = await company(browser);
  await worker.goto('/settings');
  const [download] = await Promise.all([worker.waitForEvent('download'), worker.getByRole('button', { name: 'Descargar' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^mis-datos-hr-core-\d{4}-\d{2}-\d{2}\.zip$/);
});

test('eliminar la cuenta en una instalación abierta', async ({ browser }) => {
  const page = await (await browser.newContext(phone)).newPage();
  failOnPageErrors(page);
  const who = person('Baja Voluntaria');
  await register(page, who);
  await expect(page.getByRole('heading', { name: /Baja/ })).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Eliminar cuenta' }).click();
  await page.getByLabel('Escribe tu contraseña para confirmar').fill('no-es-esta');
  await page.getByRole('button', { name: 'Eliminar mi cuenta' }).click();
  await expect(page.getByText('Correo o contraseña incorrectos.')).toBeVisible();
  await page.getByLabel('Escribe tu contraseña para confirmar').fill(PASSWORD);
  await page.getByRole('button', { name: 'Eliminar mi cuenta' }).click();
  await expect(page.getByText('Tu cuenta se ha eliminado.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(who.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Correo o contraseña incorrectos.')).toBeVisible();
});
