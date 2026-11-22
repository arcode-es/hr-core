import { expect, test } from '@playwright/test';
import { company, drawSignature, samplePdf, samplePhoto } from './helpers';

test('documentos: enviar a firmar, pedir DNI, firmar en pantalla, confirmar lectura, justificante y seguimiento', async ({ browser }) => {
  const { boss: d, worker: m } = await company(browser);
  const payslip = { name: 'nómina-octubre.pdf', mimeType: 'application/pdf', buffer: await samplePdf('Nómina de octubre') };

  await d.goto('/documents');
  await d.getByRole('button', { name: 'Enviar' }).click();
  await d.getByRole('button', { name: 'Enviar', exact: true }).last().click();
  await expect(d.getByText('Elige el archivo que quieres enviar.')).toBeVisible();
  await d.locator('input[type=file]').setInputFiles(payslip);
  await d.getByLabel('Título').fill('Nómina de octubre');
  await d.getByRole('checkbox', { name: /Luis Peña Soler/ }).click();
  await d.getByRole('radio', { name: 'Firmar', exact: true }).click();
  await d.getByRole('button', { name: 'Enviar', exact: true }).last().click();
  await expect(d.getByText('Enviado a 1 persona')).toBeVisible();

  await d.getByRole('button', { name: 'Enviar' }).first().click();
  await d.locator('input[type=file]').setInputFiles({ ...payslip, name: 'normas.pdf' });
  await d.getByLabel('Título').fill('Normas de seguridad');
  await d.getByLabel('Tipo de documento').selectOption('SAFETY');
  await d.getByRole('radio', { name: /Toda la plantilla/ }).click();
  await d.getByRole('button', { name: 'Enviar', exact: true }).last().click();
  await expect(d.getByText('Enviado a 1 persona').last()).toBeVisible();

  // Sin DNI en el perfil no se puede firmar: la app lleva al perfil.
  await m.goto('/documents');
  await m.getByRole('link', { name: /Nómina de octubre/ }).click();
  await expect(m.locator('[data-pages] canvas').first()).toBeVisible();
  await m.getByRole('button', { name: 'Firmar documento' }).click();
  await m.getByRole('link', { name: 'Añadir mi DNI/NIE' }).click();
  await m.getByLabel('DNI / NIE').fill('12345678Z');
  await m.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(m.getByText('Cambios guardados')).toBeVisible();

  // Firmar con el dedo: el botón no se activa con el lienzo vacío.
  await m.goto('/documents');
  await m.getByRole('link', { name: /Nómina de octubre/ }).click();
  await m.getByRole('button', { name: 'Firmar documento' }).click();
  await expect(m.getByRole('button', { name: 'Firmar', exact: true })).toBeDisabled();
  await drawSignature(m);
  await m.getByRole('button', { name: 'Firmar', exact: true }).click();
  await expect(m.getByText('Documento firmado')).toBeVisible();
  // El PDF firmado añade la página de certificado.
  await expect(m.locator('[data-pages] canvas')).toHaveCount(2);
  await expect(m.getByRole('button', { name: 'Firmar documento' })).toHaveCount(0);

  // Comunicado: lectura explícita.
  await m.goto('/documents');
  await m.getByRole('link', { name: /Normas de seguridad/ }).click();
  await m.getByRole('button', { name: 'He leído el documento' }).click();
  await expect(m.getByText('Lectura confirmada')).toBeVisible();

  // Justificante del empleado hacia sus responsables.
  await m.goto('/documents');
  await m.getByRole('button', { name: 'Justificante' }).click();
  await m.locator('input[type=file]').setInputFiles({ name: 'parte.jpg', mimeType: 'image/jpeg', buffer: await samplePhoto(m) });
  await m.getByLabel('Título').fill('Parte de baja');
  await m.getByRole('button', { name: 'Enviar', exact: true }).last().click();
  await expect(m.getByText('Enviado a 1 persona')).toBeVisible();

  // Seguimiento y descarga del firmado.
  await d.reload();
  await expect(d.getByRole('link', { name: /Parte de baja/ })).toBeVisible();
  await d.getByRole('radio', { name: 'Enviados' }).click();
  await expect(d.getByText('1 de 1 firmados')).toBeVisible();
  await expect(d.getByText('1 de 1 leídos')).toBeVisible();
  await d.getByRole('button', { name: /Nómina de octubre/ }).click();
  await d.getByRole('link', { name: /Luis Peña Soler/ }).click();
  await expect(d.locator('[data-pages] canvas')).toHaveCount(2);
  const [download] = await Promise.all([d.waitForEvent('download'), d.getByRole('button', { name: 'Descargar' }).click()]);
  expect(download.suggestedFilename()).toBe('nómina-octubre-firmado.pdf');
});
