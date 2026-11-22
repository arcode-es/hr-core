import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import AxeBuilder from './axe';
import { apiCall, company, failOnPageErrors, lastMailTo, linkIn, person, phone, register } from './helpers';

/** PDF de nóminas «de la gestoría»: una página por persona con su DNI y una hoja de totales. */
async function payrollPdf(pages: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) pdf.addPage([595, 842]).drawText(text, { x: 60, y: 760, size: 14, font });
  return Buffer.from(await pdf.save());
}

/** El mes anterior al actual, en AAAA-MM y en letra («octubre de 2026»). */
function previousMonth(): { iso: string; day: string; label: string } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 10);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { iso, day: `${iso}-10`, label: new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(d) };
}

test('alta masiva: plantilla con errores fila a fila, departamentos nuevos y datos que llegan al registro', async ({ browser }) => {
  const c = await company(browser);
  const b = c.boss;
  const nueva = person('Nuria Gil Sastre');
  const otro = person('Pedro Ros Vila');
  const csv = [
    'Nombre y apellidos;Correo electrónico;DNI/NIE;Rol;Departamento;Puesto;Horas semanales',
    `${nueva.name};${nueva.email};12345678Z;Empleado;Obra;Oficial de 1ª;40`,
    `${otro.name};${otro.email};;Responsable;Oficina;Administración;20`,
    `Sin Correo;no-es-un-correo;;Empleado;;;`,
  ].join('\n');

  await b.goto('/team');
  await b.getByRole('button', { name: 'Importar plantilla' }).click();
  await expect(b.getByRole('heading', { name: 'Alta masiva desde Excel o CSV' })).toBeVisible();
  await b.locator('dialog[open] input[type=file]').setInputFiles({ name: 'equipo.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(b.getByText('2 personas listas para invitar')).toBeVisible();
  await expect(b.getByText('1 fila con errores: no se importa')).toBeVisible();
  await expect(b.getByText('Correo no válido')).toBeVisible();
  await b.waitForTimeout(600);
  expect(await AxeBuilder(b)).toEqual([]);
  await b.getByRole('button', { name: 'Invitar a 2 personas' }).click();
  await expect(b.getByText('2 invitaciones enviadas Se han creado 2 departamentos nuevos.')).toBeVisible();

  // Invitaciones con su estado y departamentos creados.
  await expect(b.getByRole('heading', { name: 'Invitaciones' })).toBeVisible();
  await expect(b.getByText(nueva.name)).toBeVisible();
  await expect(b.getByText('Pendiente', { exact: true }).first()).toBeVisible();
  await expect(b.getByRole('heading', { name: 'Departamentos' })).toBeVisible();
  await expect(b.getByText('Obra', { exact: true })).toBeVisible();
  await b.waitForTimeout(600);
  expect(await AxeBuilder(b)).toEqual([]);

  // Nuria acepta desde su correo: el nombre ya viene escrito y entra con su departamento.
  const mail = await lastMailTo(nueva.email);
  const m = await (await browser.newContext(phone)).newPage();
  failOnPageErrors(m);
  await m.goto(linkIn(mail, '/invite/'));
  await m.getByRole('link', { name: 'Crear cuenta' }).click();
  await expect(m.getByLabel('Nombre y apellidos')).toHaveValue(nueva.name);
  await register(m, nueva);
  await m.getByRole('button', { name: /Unirme a/ }).click();
  await expect(m.getByRole('heading', { name: /Nuria/ })).toBeVisible();

  await b.reload();
  await expect(b.getByText(`${nueva.email} · Obra`)).toBeVisible();
  await expect(b.getByText('Aceptada', { exact: true })).toHaveCount(2); // Luis (al crear la empresa) y Nuria
});

test('nóminas en un PDF: se reparten por DNI y cada persona recibe solo la suya', async ({ browser }) => {
  const c = await company(browser);
  await apiCall(c.worker, 'PATCH', '/me', { dniNie: '12345678Z' });
  const pdf = await payrollPdf([`Recibo de salarios · ${c.workerPerson.name} · DNI 12345678-Z`, 'Resumen de costes de la empresa (sin datos personales)']);

  await c.boss.goto('/documents');
  await c.boss.getByRole('link', { name: 'Enviar nóminas' }).click();
  await expect(c.boss.getByRole('heading', { name: 'Enviar nóminas' })).toBeVisible();
  await c.boss.locator('input[type=file]').setInputFiles({ name: 'nominas.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(c.boss.getByText('DNI/NIE 12345678Z')).toBeVisible();
  await expect(c.boss.getByLabel('Enviar la página 1 a')).toHaveValue(c.workerId);
  await expect(c.boss.getByText('Sin DNI/NIE')).toBeVisible();
  await expect(c.boss.getByText('1 página sin dueño: no se envía')).toBeVisible();
  await c.boss.waitForTimeout(600);
  expect(await AxeBuilder(c.boss)).toEqual([]);
  await c.boss.getByLabel('Título del documento').fill('Nómina de prueba');
  await c.boss.getByRole('button', { name: 'Enviar 1 nómina' }).click();
  await expect(c.boss.getByText('1 nómina enviada')).toBeVisible();
  await expect(c.boss).toHaveURL(/\/documents$/);

  await c.worker.goto('/documents');
  await expect(c.worker.getByText('Nómina de prueba')).toBeVisible();
});

test('registro mensual para firmar con plazo, registro de la plantilla y avisos por correo', async ({ browser }) => {
  const c = await company(browser);
  const month = previousMonth();
  await apiCall(c.boss, 'POST', '/time/manual', { userId: c.workerId, start: `${month.day}T07:00:00.000Z`, end: `${month.day}T15:00:00.000Z`, breaks: [], reason: 'Jornada de prueba' }, c.orgId);

  await c.boss.goto('/documents');
  await c.boss.getByRole('button', { name: 'Registro mensual' }).click();
  await expect(c.boss.getByRole('heading', { name: 'Enviar el registro de jornada' })).toBeVisible();
  await expect(c.boss.getByLabel('Mes')).toHaveValue(month.iso);
  await c.boss.getByRole('button', { name: 'Enviar registros' }).click();
  await expect(c.boss.getByText('1 enviados · 0 ya lo tenían')).toBeVisible();

  await c.worker.goto('/documents');
  await expect(c.worker.getByText(`Registro de jornada de ${month.label}`)).toBeVisible();
  await expect(c.worker.getByText(/^Vence el/)).toBeVisible();
  await c.worker.waitForTimeout(600);
  expect(await AxeBuilder(c.worker)).toEqual([]);

  // La plantilla entera, en Excel.
  await c.boss.goto('/reports');
  await c.boss.getByRole('button', { name: 'Anterior' }).click();
  const [xlsx] = await Promise.all([
    c.boss.waitForEvent('download'),
    c.boss.getByRole('button', { name: 'Descargar Registro de toda la plantilla en Excel' }).click(),
  ]);
  expect(xlsx.suggestedFilename()).toBe(`registro-jornada-plantilla-${month.iso}.xlsx`);

  // Avisos por correo: cada uno elige.
  await c.worker.goto('/settings');
  await expect(c.worker.getByRole('heading', { name: 'Avisos por correo' })).toBeVisible();
  const docs = c.worker.getByRole('switch', { name: /^Documentos/ });
  await expect(docs).toBeChecked();
  await docs.uncheck({ force: true });
  await expect(c.worker.getByText('Preferencias guardadas')).toBeVisible();
  await c.worker.reload();
  await expect(c.worker.getByRole('switch', { name: /^Documentos/ })).not.toBeChecked();
  await expect(c.worker.getByRole('switch', { name: /Resumen diario/ })).toHaveCount(0); // no supervisa
});
