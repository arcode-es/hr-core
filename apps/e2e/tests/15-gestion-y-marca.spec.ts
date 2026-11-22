import { expect, test } from '@playwright/test';
import AxeBuilder from './axe';
import { apiCall, company } from './helpers';

test('marca del cliente: nombre comercial, color con contraste AA y logotipo en la cabecera', async ({ browser }) => {
  const c = await company(browser);
  const b = c.boss;
  await b.goto('/company');
  await b.getByLabel('Nombre comercial').fill('Reformas Ortega');
  await b.getByLabel('Color de la marca').fill('#f59e0b'); // un ámbar claro: con texto blanco no llega a AA
  await b.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(b.getByText('Ajustes de empresa guardados')).toBeVisible();

  // El acento se aplica ya ajustado: el texto blanco sobre él cumple 4,5:1.
  const accent = await b.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  expect(accent).not.toBe('#4f46e5');
  const ratio = await b.evaluate((hex) => {
    const lum = (h: string) =>
      [1, 3, 5]
        .map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
        .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    return (1.05) / (lum(hex) + 0.05);
  }, accent);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  await expect(b.locator('aside').getByText('Reformas Ortega', { exact: true })).toBeVisible();

  // Logotipo: se sube al momento y aparece en la cabecera.
  const logo = await b.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 120, height: 40 } });
  await b.locator('#company-logo').locator('..').locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
  await expect(b.getByText('Logotipo guardado')).toBeVisible();
  await expect(b.locator('aside img')).toBeVisible();
  await b.waitForTimeout(600);
  expect(await AxeBuilder(b)).toEqual([]);

  // Al empleado le llega la misma marca con su sesión.
  const me = await apiCall<{ workspaces: { organizationId?: string; branding?: { name: string; accent: string; logo: boolean } }[] }>(c.worker, 'GET', '/me');
  expect(me.workspaces.find((w) => w.organizationId === c.orgId)?.branding).toEqual({ name: 'Reformas Ortega', accent: '#f59e0b', logo: true });
});

test('coste por obra y archivo para la gestoría', async ({ browser }) => {
  const c = await company(browser);
  const b = c.boss;
  const site = await apiCall<{ id: string }>(b, 'POST', '/locations', { name: 'Obra Malvarrosa', latitude: 39.48, longitude: -0.32, geofenceRadiusMeters: 120 }, c.orgId);
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  await apiCall(b, 'POST', '/time/manual', { userId: c.workerId, start: `${day}T07:00:00.000Z`, end: `${day}T15:00:00.000Z`, breaks: [], locationId: site.id, reason: 'Jornada de prueba' }, c.orgId);

  // Coste por hora del empleado (solo lo ve la administración).
  await b.goto('/team');
  await b.getByRole('button', { name: new RegExp(c.workerPerson.name) }).click();
  await b.getByLabel('Coste por hora (€)').fill('18.5');
  await b.getByRole('button', { name: 'Guardar' }).click();
  await expect(b.getByText('Guardado')).toBeVisible();

  await b.getByRole('link', { name: 'Coste por obra' }).first().click();
  await expect(b.getByRole('heading', { name: 'Coste por obra' })).toBeVisible();
  await expect(b.getByRole('figure').getByRole('listitem', { name: /^Obra Malvarrosa: 148/ })).toBeVisible();
  await expect(b.getByRole('rowheader', { name: /Obra Malvarrosa/ })).toBeVisible();
  await expect(b.getByRole('row', { name: /Obra Malvarrosa/ })).toContainText('148');
  await b.waitForTimeout(600);
  expect(await AxeBuilder(b)).toEqual([]);
  const [xlsx] = await Promise.all([b.waitForEvent('download'), b.getByRole('button', { name: 'Descargar en Excel' }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^coste-por-obra-\d{4}-\d{2}\.xlsx$/);

  // Columnas del archivo para la gestoría y su descarga.
  await b.goto('/company');
  await b.getByRole('checkbox', { name: 'Departamento' }).uncheck();
  await b.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(b.getByText('Ajustes de empresa guardados')).toBeVisible();
  await b.goto('/reports');
  const [csv] = await Promise.all([b.waitForEvent('download'), b.getByRole('button', { name: 'Descargar Exportación para la gestoría en CSV' }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^gestoria-\d{4}-\d{2}\.csv$/);
  const text = (await (await csv.createReadStream()).toArray()).map(String).join('');
  expect(text).not.toContain('Departamento');
  expect(text).toContain(c.workerPerson.name);
});

test('turnos rotativos: crear un patrón y aplicarlo como borradores', async ({ browser }) => {
  const c = await company(browser);
  const b = c.boss;
  await b.goto('/schedule');
  await b.getByRole('button', { name: 'Turnos rotativos' }).click();
  await expect(b.getByText('Todavía no hay patrones.')).toBeVisible();
  await b.getByRole('button', { name: 'Nuevo patrón' }).click();
  await b.getByLabel('Nombre del patrón').fill('Mañana, mañana, libre, libre');
  await b.waitForTimeout(600);
  expect(await AxeBuilder(b)).toEqual([]);
  await b.getByRole('button', { name: 'Guardar patrón' }).click();
  await expect(b.getByText('Patrón guardado')).toBeVisible();
  await b.getByRole('button', { name: 'Aplicar' }).click();
  await b.getByRole('checkbox', { name: c.workerPerson.name }).click();
  await b.getByLabel('Semanas').fill('1');
  await b.getByRole('button', { name: 'Crear los turnos en borrador' }).click();
  await expect(b.getByText(/^4 turnos creados en borrador/)).toBeVisible();

  // La semana que viene: lunes, martes, viernes y sábado con turno, en borrador.
  await b.getByRole('button', { name: 'Siguiente' }).click();
  await expect(b.getByText('07:00–15:00').first()).toBeVisible();
  await expect(b.getByRole('button', { name: /Publicar/ })).toBeVisible();
});
