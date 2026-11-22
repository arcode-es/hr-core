import { expect, test } from '@playwright/test';
import { company, samplePhoto } from './helpers';

test('gastos: ticket con propuesta del OCR, kilometraje, categoría propia, aprobar, rechazar, reenviar y liquidar', async ({ browser }) => {
  const { boss: d, worker: m } = await company(browser);
  const photo = { name: 'ticket.jpg', mimeType: 'image/jpeg', buffer: await samplePhoto(m) };

  // Categoría propia de la empresa.
  await d.goto('/expenses');
  await d.getByRole('button', { name: 'Categorías' }).click();
  await d.getByLabel('Nombre').fill('EPIs');
  await d.getByLabel('Se agrupa con').selectOption('MATERIAL');
  await d.getByRole('button', { name: 'Añadir categoría' }).click();
  await expect(d.getByRole('button', { name: 'Retirar EPIs' })).toBeVisible();
  await d.getByRole('button', { name: 'Cerrar' }).click();

  // Ticket con foto; la propuesta del OCR se simula (el proveedor por defecto no propone nada).
  const today = new Date().toISOString().slice(0, 10);
  await m.route('**/expenses/ocr', (r) => r.fulfill({ json: { provider: 'e2e', amount: 23.9, taxAmount: 2.17, date: today, merchantName: 'Bar Pepe', merchantTaxId: null } }));
  await m.goto('/expenses');
  await m.locator('input[type=file]').first().setInputFiles(photo);
  await expect(m.getByText('Hemos rellenado algunos datos')).toBeVisible();
  await expect(m.getByLabel(/Importe total/)).toHaveValue('23,90');
  await m.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(m.getByText('Gasto enviado para aprobar')).toBeVisible();
  await m.unroute('**/expenses/ocr');

  // Kilometraje: el total lo calcula la tarifa de la empresa.
  await m.getByRole('button', { name: 'Sin ticket' }).click();
  await m.getByRole('button', { name: 'Kilometraje' }).click();
  await m.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(m.getByText('Introduce los kilómetros recorridos')).toBeVisible();
  await m.getByLabel('Kilómetros').fill('120');
  await expect(m.getByText(/Total 31,20/)).toBeVisible();
  await m.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(m.getByText('Gasto enviado para aprobar').last()).toBeVisible();

  // Categoría propia, pagado con tarjeta de empresa; sin OCR real no hay propuesta.
  await m.locator('input[type=file]').first().setInputFiles(photo);
  await m.getByRole('button', { name: 'EPIs' }).click();
  await expect(m.getByText('Hemos rellenado algunos datos')).toHaveCount(0);
  await m.getByLabel(/Importe total/).fill('45');
  await m.getByLabel('Comercio').fill('Ferretería Turia');
  await m.getByRole('radio', { name: 'Tarjeta de empresa' }).click();
  await m.getByRole('button', { name: 'Guardar gasto' }).click();
  await expect(m.getByText('Ferretería Turia')).toBeVisible();

  // La responsable aprueba dos y rechaza el kilometraje.
  await d.reload();
  await d.getByRole('radio', { name: 'Por aprobar (3)' }).click();
  await d.getByRole('button', { name: /Bar Pepe/ }).click();
  await expect.poll(() => d.evaluate(() => (document.querySelector('dialog[open] img') as HTMLImageElement | null)?.naturalWidth ?? 0)).toBeGreaterThan(0);
  await d.getByRole('button', { name: 'Aprobar' }).click();
  await expect(d.getByText('Gasto aprobado')).toBeVisible();
  await d.getByRole('button', { name: /Kilometraje/ }).click();
  await d.getByRole('button', { name: 'Rechazar' }).click();
  await d.getByPlaceholder(/Explica qué falta/).fill('Indica el trayecto en las notas');
  await d.getByRole('button', { name: 'Rechazar' }).last().click();
  await d.getByRole('button', { name: /Ferretería Turia/ }).click();
  await d.getByRole('button', { name: 'Aprobar' }).click();
  await expect(d.getByText('Nada por aprobar')).toBeVisible();

  // El empleado corrige el rechazado y lo reenvía; uno aprobado ya no se edita.
  await m.reload();
  await m.getByRole('button', { name: /Kilometraje/ }).click();
  await expect(m.getByText(/Indica el trayecto/)).toBeVisible();
  await m.getByRole('button', { name: 'Corregir y reenviar' }).click();
  await m.getByLabel('Notas').fill('Valencia – Sagunto – Valencia');
  await m.getByRole('button', { name: 'Corregir y reenviar' }).click();
  await expect(m.getByText('Gasto enviado para aprobar')).toBeVisible();
  await m.getByRole('button', { name: /Bar Pepe/ }).click();
  await expect(m.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await m.getByRole('button', { name: 'Cerrar' }).click();

  await d.reload();
  await d.getByRole('radio', { name: 'Por aprobar (1)' }).click();
  await d.getByRole('button', { name: /Kilometraje/ }).click();
  await d.getByRole('button', { name: 'Aprobar' }).click();

  // Liquidación: lo adelantado se reembolsa; la tarjeta de empresa no.
  await d.getByRole('radio', { name: 'Liquidación' }).click();
  await expect(d.getByText('55,10 €').first()).toBeVisible();
  await d.getByRole('button', { name: 'Marcar como pagado' }).click();
  await d.getByRole('button', { name: /Marcar 55,10/ }).click();
  await expect(d.getByText(/marcados como pagados/)).toBeVisible();
  await m.reload();
  await expect(m.getByText('Pagado', { exact: true }).first()).toBeVisible();
});
