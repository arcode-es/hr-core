import AxeBuilder from './axe';
import { expect, test } from '@playwright/test';
import { company, phone, samplePdf } from './helpers';

test('avisos: campana, enlace al destino, panel del responsable y ajustes de empresa aplicados', async ({ browser }) => {
  const { boss: d, worker: m } = await company(browser);

  await m.goto('/clock');
  await m.getByRole('button', { name: 'Añadir jornada' }).click();
  await m.getByLabel('Motivo').fill('Olvidé fichar ayer');
  await m.getByRole('button', { name: 'Enviar para validar' }).click();
  await expect(m.getByText('Enviado a tu responsable')).toBeVisible();

  await d.goto('/');
  await expect(d.getByText('Tu equipo ahora')).toBeVisible();
  await d.getByRole('button', { name: 'Avisos: 1 sin leer' }).click();
  await d.getByRole('button', { name: /ha enviado una jornada para validar/ }).click();
  await expect(d.getByRole('heading', { name: 'Fichajes' })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Avisos', exact: true })).toBeVisible();
  await d.getByRole('radio', { name: /Pendientes/ }).click();
  await d.getByRole('button', { name: 'Aprobar' }).click();

  await d.goto('/documents');
  await d.getByRole('button', { name: 'Enviar' }).click();
  await d.locator('input[type=file]').setInputFiles({ name: 'contrato.pdf', mimeType: 'application/pdf', buffer: await samplePdf('Contrato') });
  await d.getByLabel('Título').fill('Contrato de trabajo');
  await d.getByRole('checkbox', { name: /Luis Peña Soler/ }).click();
  await d.getByRole('radio', { name: 'Firmar', exact: true }).click();
  await d.getByRole('button', { name: 'Enviar', exact: true }).last().click();
  await expect(d.getByText('Enviado a 1 persona')).toBeVisible();

  await m.goto('/');
  await expect(m.getByText('Tienes 1 documento pendiente')).toBeVisible();
  await m.getByRole('button', { name: 'Avisos: 2 sin leer' }).click();
  await expect(m.getByText('Tu jornada ha sido aprobada.')).toBeVisible();
  await m.getByRole('button', { name: /Tienes un documento por firmar: Contrato de trabajo/ }).click();
  await expect(m.getByRole('heading', { name: 'Contrato de trabajo' })).toBeVisible();

  // Desactivar las horas manuales de empleados se aplica al momento.
  await d.goto('/company');
  await d.getByRole('switch', { name: /Los empleados pueden introducir horas a mano/ }).uncheck({ force: true });
  await d.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(d.getByText('Ajustes de empresa guardados')).toBeVisible();
  await m.goto('/clock');
  await m.getByRole('button', { name: 'Añadir jornada' }).click();
  await m.getByLabel('Inicio', { exact: true }).fill('06:00');
  await m.getByLabel('Fin', { exact: true }).fill('07:00');
  await m.getByLabel('Motivo').fill('Prueba con el permiso desactivado');
  await m.getByRole('button', { name: 'Enviar para validar' }).click();
  await expect(m.getByText(/no permite introducir horas a mano/)).toBeVisible();
});

test('accesibilidad: sin incidencias WCAG 2 A/AA en las pantallas principales', async ({ browser }) => {
  const { boss: d, worker: m } = await company(browser);
  const violations: string[] = [];
  const audit = async (page: typeof d, label: string): Promise<void> => {
    await page.waitForTimeout(500);
    for (const v of await AxeBuilder(page)) violations.push(`${label}: ${v}`);
  };
  for (const path of ['/', '/timesheets', '/alerts', '/schedule', '/absences', '/expenses', '/documents', '/documents/payroll', '/team', '/sites', '/locations', '/reports', '/company', '/settings']) {
    await d.goto(path);
    await expect(d.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await audit(d, `responsable ${path}`);
  }
  for (const path of ['/', '/clock', '/schedule', '/absences', '/expenses', '/documents', '/more', '/settings']) {
    await m.goto(path);
    await expect(m.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await audit(m, `empleado ${path}`);
  }
  // Pantallas sin sesión: acceso y recuperación de contraseña (con un enlace no válido).
  const guest = await (await browser.newContext(phone)).newPage();
  for (const path of ['/login', '/register', '/forgot-password', '/reset-password?token=no-es-un-enlace-valido-de-verdad', '/legal/privacidad', '/legal/aviso-legal', '/legal/cookies', '/kiosk']) {
    await guest.goto(path);
    await expect(guest.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await audit(guest, `sin sesión ${path}`);
  }
  expect(violations).toEqual([]);
});
