import { expect, test } from '@playwright/test';
import { company, desktop, failOnPageErrors, lastMailTo, linkIn, PASSWORD, person, phone, register } from './helpers';

test('acceso: errores de validación, credenciales incorrectas y sesión que sobrevive a recargar', async ({ browser }) => {
  const page = await (await browser.newContext(phone)).newPage();
  failOnPageErrors(page);
  await page.goto('/register');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByText('Introduce un correo válido')).toBeVisible();

  const who = person('Ana Gil');
  await register(page, who);
  await expect(page.getByRole('heading', { name: /Ana/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Ana/ })).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Inicia sesión' })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(who.email);
  await page.getByLabel('Contraseña', { exact: true }).fill('otra-cosa');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Correo o contraseña incorrectos.')).toBeVisible();
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // Tras cerrar sesión a propósito se entra al inicio, no a la última página del usuario anterior.
  await expect(page.getByRole('heading', { name: /Ana/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('una sesión caducada devuelve a la página en la que se estaba', async ({ browser }) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  failOnPageErrors(page);
  const who = person('Rosa Vidal');
  await register(page, who);
  await expect(page.getByRole('heading', { name: /Rosa/ })).toBeVisible();
  await page.goto('/expenses');
  await expect(page.getByRole('heading', { name: 'Gastos', exact: true })).toBeVisible();
  await context.clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/login\?next=%2Fexpenses/);
  await page.getByLabel('Correo electrónico').fill(who.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Gastos', exact: true })).toBeVisible();
});

test('empresa: invitar por enlace, roles, permisos del empleado y dispositivo nuevo', async ({ browser }) => {
  const { boss, worker, bossPerson, workerPerson } = await company(browser);

  // El empleado entra directamente en la empresa y no ve la gestión del equipo.
  await expect(worker.getByRole('button', { name: /Cambiar de espacio: Reformas Ortega/ })).toBeVisible();
  await worker.goto('/more');
  await expect(worker.getByRole('link', { name: 'Ajustes' })).toBeVisible();
  await expect(worker.getByRole('link', { name: 'Equipo' })).toHaveCount(0);

  // La responsable le cambia el rol.
  await boss.goto('/team');
  await boss.getByRole('button', { name: new RegExp(workerPerson.name) }).click();
  await boss.getByRole('radio', { name: /Responsable/ }).click();
  await expect(boss.getByText('Rol actualizado')).toBeVisible();

  // En un dispositivo nuevo se entra en la empresa, no en el espacio personal.
  const other = await (await browser.newContext(desktop)).newPage();
  await other.goto('/login');
  await other.getByLabel('Correo electrónico').fill(bossPerson.email);
  await other.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await other.getByRole('button', { name: 'Entrar' }).click();
  await expect(other.getByRole('button', { name: /Cambiar de espacio: Reformas Ortega/ })).toBeVisible();
  await other.getByRole('link', { name: 'Equipo', exact: true }).click();
  await expect(other.getByText(workerPerson.name)).toBeVisible();
});

test('ajustes: perfil, tema e idioma', async ({ browser }) => {
  const page = await (await browser.newContext(phone)).newPage();
  failOnPageErrors(page);
  await register(page, person('Eva Sanz'));
  await expect(page.getByRole('heading', { name: /Eva/ })).toBeVisible();
  await page.goto('/settings');
  await page.getByLabel('DNI / NIE').fill('12345678Z');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Cambios guardados')).toBeVisible();
  await page.getByRole('radio', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'Sol' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
});

test('recuperar la contraseña con el enlace del correo', async ({ browser }) => {
  const page = await (await browser.newContext(phone)).newPage();
  failOnPageErrors(page);
  const who = person('Olvido Pérez');
  await register(page, who);
  await expect(page.getByRole('heading', { name: /Olvido/ })).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  await page.getByRole('link', { name: '¿Has olvidado tu contraseña?' }).click();
  // La pantalla de acceso también tiene un campo de correo: se espera a la nueva antes de escribir.
  await expect(page.getByRole('heading', { name: 'Recupera tu contraseña' })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(who.email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

  const mail = await lastMailTo(who.email);
  expect(mail.subject).toBe('Restablece tu contraseña de HR-Core');
  const link = linkIn(mail, '/reset-password');
  await page.goto(link);
  await page.getByLabel('Nueva contraseña').fill('nueva-clave-2026');
  await page.getByLabel('Repite la contraseña').fill('otra-distinta');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Las contraseñas no coinciden')).toBeVisible();
  await page.getByLabel('Repite la contraseña').fill('nueva-clave-2026');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByText('Contraseña cambiada. Ya puedes entrar con la nueva.')).toBeVisible();
  expect((await lastMailTo(who.email)).subject).toBe('Se ha cambiado tu contraseña de HR-Core');

  await page.getByLabel('Correo electrónico').fill(who.email);
  await page.getByLabel('Contraseña', { exact: true }).fill('nueva-clave-2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Olvido/ })).toBeVisible();

  // El enlace ya usado no vale una segunda vez.
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Enlace caducado o ya usado' })).toBeVisible();
});

test('la invitación llega por correo y su enlace lleva a unirse', async ({ browser }) => {
  const boss = await (await browser.newContext(desktop)).newPage();
  failOnPageErrors(boss);
  await register(boss, person('Jefa Correo'));
  await boss.getByRole('button', { name: /Crea o únete a una empresa/ }).click();
  await boss.getByLabel('Nombre de la empresa').fill('Obras del Turia S.L.');
  await boss.getByRole('button', { name: 'Crear empresa' }).click();
  await boss.goto('/team');
  const invited = person('Nuevo Empleado');
  await boss.getByRole('button', { name: 'Invitar' }).first().click();
  await boss.getByLabel('Correo electrónico').fill(invited.email);
  await boss.getByRole('button', { name: 'Crear enlace de invitación' }).click();
  await expect(boss.getByRole('heading', { name: 'Invitación enviada' })).toBeVisible();

  const mail = await lastMailTo(invited.email);
  expect(mail.subject).toBe('Jefa Correo te invita a Obras del Turia S.L. en HR-Core');
  const page = await (await browser.newContext(phone)).newPage();
  failOnPageErrors(page);
  await page.goto(linkIn(mail, '/invite/'));
  await expect(page.getByRole('heading', { name: 'Obras del Turia S.L.' })).toBeVisible();
  await page.getByRole('link', { name: 'Crear cuenta' }).click();
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(invited.email);
});
