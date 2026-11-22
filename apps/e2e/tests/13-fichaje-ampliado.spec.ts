import { expect, test } from '@playwright/test';
import AxeBuilder from './axe';
import { apiCall, company, failOnPageErrors, samplePhoto } from './helpers';

test('QR del cartel y foto obligatoria: presencia sin GPS y fichaje «sin foto»', async ({ browser }) => {
  // Sin permiso de ubicación: el QR es lo único que demuestra la presencia.
  const c = await company(browser);
  const site = await apiCall<{ id: string }>(c.boss, 'POST', '/locations', { name: 'Reforma Colón', latitude: 39.4699, longitude: -0.3733, geofenceRadiusMeters: 100 }, c.orgId);

  // La empresa pide foto al empezar y al terminar.
  await c.boss.goto('/company');
  await c.boss.getByRole('switch', { name: /Pedir una foto al empezar y al terminar/ }).check({ force: true });
  await c.boss.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(c.boss.getByText('Ajustes de empresa guardados')).toBeVisible();

  // El cartel se descarga desde la ubicación.
  await c.boss.goto(`/locations/${site.id}`);
  await expect(c.boss.getByRole('heading', { name: 'Cartel con código QR' })).toBeVisible();
  const [poster] = await Promise.all([c.boss.waitForEvent('download'), c.boss.getByRole('button', { name: 'Descargar el cartel (PDF)' }).click()]);
  expect(poster.suggestedFilename()).toMatch(/^qr-.*\.pdf$/);
  const { code } = await apiCall<{ code: string }>(c.boss, 'POST', `/locations/${site.id}/qr`, undefined, c.orgId);

  // El empleado escanea el cartel con la cámara del móvil: se abre la app con el código.
  const m = c.worker;
  await m.goto(`/clock?l=${site.id}&k=${code}`);
  await expect(m.getByText('Fichaje con el QR de Reforma Colón')).toBeVisible();
  await expect(m.getByText('Tu empresa pide una foto al empezar y al terminar.')).toBeVisible();
  await m.getByRole('button', { name: 'Iniciar jornada' }).click();
  await expect(m.getByRole('heading', { name: 'Haz la foto para fichar' })).toBeVisible();
  await m.waitForTimeout(600);
  expect(await AxeBuilder(m)).toEqual([]);
  await m.getByRole('button', { name: 'No puedo hacer la foto' }).click();
  await expect(m.getByText('Jornada iniciada')).toBeVisible();
  await expect(m.getByText('QR', { exact: true })).toBeVisible();
  await expect(m.getByText('Sin foto', { exact: true })).toBeVisible();

  // Al terminar hace la foto desde la hoja que se la pide.
  await m.getByRole('button', { name: 'Finalizar' }).click();
  await m.getByRole('button', { name: 'Finalizar jornada' }).click();
  await m.locator('dialog[open] input[type=file]').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await samplePhoto(m) });
  await expect(m.getByText('Jornada finalizada')).toBeVisible();
  await expect(m.getByText('Listo para empezar')).toBeVisible();

  // Un QR cambiado ya no vale.
  await apiCall(c.boss, 'POST', `/locations/${site.id}/qr`, undefined, c.orgId);
  await m.goto(`/clock?l=${site.id}&k=${code}`);
  await m.getByRole('button', { name: 'Iniciar jornada' }).click();
  await m.getByRole('button', { name: 'No puedo hacer la foto' }).click();
  await expect(m.getByText('El código QR no es válido o se ha cambiado. Usa el cartel nuevo.')).toBeVisible();
});

test('quiosco: PIN propio, emparejar la tablet, fichar con PIN y verlo en el equipo', async ({ browser }) => {
  const c = await company(browser);

  // El empleado elige su PIN.
  await c.worker.goto('/settings');
  await expect(c.worker.getByText('Aún no tienes PIN.')).toBeVisible();
  await c.worker.getByLabel('PIN nuevo').fill('4826');
  await c.worker.getByLabel('Repite el PIN').fill('4862');
  await c.worker.getByRole('button', { name: 'Guardar PIN' }).click();
  await expect(c.worker.getByText('Los dos PIN no coinciden.')).toBeVisible();
  await c.worker.getByLabel('Repite el PIN').fill('4826');
  await c.worker.getByRole('button', { name: 'Guardar PIN' }).click();
  await expect(c.worker.getByText('PIN guardado')).toBeVisible();
  await expect(c.worker.getByText('Ya tienes un PIN. Puedes cambiarlo cuando quieras.')).toBeVisible();

  // La administración crea el quiosco y obtiene el código para emparejar.
  await c.boss.goto('/company');
  await c.boss.getByLabel('Nombre del quiosco').fill('Tablet de la entrada');
  await c.boss.getByRole('button', { name: 'Añadir quiosco' }).click();
  await expect(c.boss.getByRole('heading', { name: 'Empareja la tablet' })).toBeVisible();
  const code = (await c.boss.locator('dialog[open] p.font-mono.text-4xl').innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);
  await c.boss.getByRole('button', { name: 'Cerrar' }).first().click();

  // La tablet: sin sesión de nadie.
  const tabletContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'es-ES', timezoneId: 'Europe/Madrid', hasTouch: true });
  const tablet = await tabletContext.newPage();
  failOnPageErrors(tablet);
  await tablet.goto('/kiosk');
  await expect(tablet.getByRole('heading', { name: 'Emparejar esta tablet' })).toBeVisible();
  await tablet.waitForTimeout(600);
  expect(await AxeBuilder(tablet)).toEqual([]);
  await tablet.getByLabel('Código de emparejamiento').fill(code.toLowerCase());
  await tablet.getByRole('button', { name: 'Emparejar' }).click();
  await expect(tablet.getByRole('heading', { name: '¿Quién eres?' })).toBeVisible();
  await expect(tablet.getByText('Reformas Ortega S.L.')).toBeVisible();
  await tablet.waitForTimeout(600);
  expect(await AxeBuilder(tablet)).toEqual([]);

  // PIN equivocado y después el bueno.
  await tablet.getByPlaceholder('Busca tu nombre').fill('luis pena');
  await tablet.getByRole('button', { name: c.workerPerson.name }).click();
  for (const d of '1111') await tablet.getByRole('button', { name: d, exact: true }).click();
  await tablet.getByRole('button', { name: 'Aceptar' }).click();
  await expect(tablet.getByText('PIN incorrecto.')).toBeVisible();
  await tablet.waitForTimeout(600);
  expect(await AxeBuilder(tablet)).toEqual([]);
  await tablet.keyboard.type('4826');
  await tablet.keyboard.press('Enter');
  await expect(tablet.getByRole('heading', { name: `Hola, ${c.workerPerson.name}` })).toBeVisible();
  await expect(tablet.getByText('Sin fichar')).toBeVisible();
  await tablet.getByRole('button', { name: 'Entrar' }).click();
  await expect(tablet.getByRole('heading', { name: 'Entrada registrada' })).toBeVisible();
  // Vuelve sola a la lista para la siguiente persona.
  await expect(tablet.getByRole('heading', { name: '¿Quién eres?' })).toBeVisible({ timeout: 10_000 });

  // En su móvil ve la jornada empezada en el quiosco.
  await c.worker.goto('/clock');
  await expect(c.worker.getByText('Trabajando')).toBeVisible();
  await expect(c.worker.getByText('Quiosco', { exact: true })).toBeVisible();

  // La responsable también, y puede imprimirle la tarjeta del quiosco.
  await c.boss.goto('/timesheets');
  await c.boss.getByRole('button', { name: new RegExp(c.workerPerson.name) }).click();
  await expect(c.boss.getByText('Quiosco', { exact: true })).toBeVisible();
  await c.boss.goto('/team');
  await c.boss.getByRole('button', { name: new RegExp(c.workerPerson.name) }).click();
  const [card] = await Promise.all([c.boss.waitForEvent('download'), c.boss.getByRole('button', { name: 'Tarjeta del quiosco (PDF)' }).click()]);
  expect(card.suggestedFilename()).toMatch(/^tarjeta-.*\.pdf$/);

  // Sale desde la tablet.
  await tablet.getByRole('button', { name: c.workerPerson.name }).click();
  await tablet.keyboard.type('4826');
  await tablet.keyboard.press('Enter');
  await expect(tablet.getByText('Trabajando')).toBeVisible();
  await tablet.getByRole('button', { name: 'Salir' }).click();
  await expect(tablet.getByRole('heading', { name: 'Salida registrada' })).toBeVisible();
  await tabletContext.close();
});

test('alertas de jornada: ajustes en Empresa y pantalla de alertas', async ({ browser }) => {
  const c = await company(browser);
  await c.boss.goto('/company');
  await expect(c.boss.getByRole('switch', { name: /Activar las alertas/ })).toBeChecked();
  await c.boss.getByLabel('Límite anual de horas extra').fill('60');
  await c.boss.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(c.boss.getByText('Ajustes de empresa guardados')).toBeVisible();
  await c.boss.waitForTimeout(600);
  expect(await AxeBuilder(c.boss)).toEqual([]);

  await c.boss.getByRole('link', { name: 'Alertas' }).first().click();
  await expect(c.boss.getByRole('heading', { name: 'Alertas' })).toBeVisible();
  await expect(c.boss.getByText('No hay alertas abiertas. Todo en orden.')).toBeVisible();
  await c.boss.getByRole('radio', { name: 'Todas' }).click();
  await expect(c.boss.getByText('Todavía no ha habido ninguna alerta.')).toBeVisible();
  await c.boss.waitForTimeout(600);
  expect(await AxeBuilder(c.boss)).toEqual([]);

  // El empleado no tiene esta pantalla.
  await c.worker.goto('/alerts');
  await expect(c.worker).toHaveURL(/\/$/);
});
