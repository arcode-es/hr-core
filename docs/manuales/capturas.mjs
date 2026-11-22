/**
 * Capturas de los manuales, hechas sobre la demo publicada.
 *
 *   node docs/manuales/capturas.mjs                 (https://arcode.es/HR-core/demo/)
 *   PROD_URL=http://localhost:4174/HR-core/ node docs/manuales/capturas.mjs
 *
 * Usa el Playwright de apps/e2e. Deja datos de prueba en la demo (un documento por firmar,
 * un quiosco, una jornada): conviene partir de la demo recién restablecida y restablecerla
 * después (`docker compose exec api node dist/cli.js demo-reset`).
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../apps/e2e/package.json'));
const { chromium } = require('@playwright/test');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const URL_BASE = (process.env.PROD_URL ?? 'https://arcode.es/HR-core/demo/').replace(/\/?$/, '/');
const OUT = join(here, 'capturas');
mkdirSync(OUT, { recursive: true });

const common = { locale: 'es-ES', timezoneId: 'Europe/Madrid', colorScheme: 'light', baseURL: URL_BASE };
const phone = { ...common, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const desktop = { ...common, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 };
const tabletOptions = { ...common, viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1.5, hasTouch: true };

// --lang: las fechas y horas de los campos nativos salen en formato español.
const browser = await chromium.launch({ args: ['--lang=es-ES'], env: { ...process.env, LANG: 'es_ES.UTF-8', LANGUAGE: 'es' } });
const failures = [];

/** Guarda la pantalla (o solo un elemento) como JPEG. */
async function shot(page, name, { full = false, of } = {}) {
  await page.waitForTimeout(700);
  const target = of ?? page;
  await target.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 88, ...(of ? {} : { fullPage: full }) });
  console.log(`  ✓ ${name}`);
}

/** Un paso que puede fallar sin tirar el resto de las capturas. */
async function step(label, fn) {
  try {
    await fn();
  } catch (e) {
    failures.push(label);
    console.log(`  ✗ ${label}: ${String(e.message).split('\n')[0]}`);
  }
}

async function enter(account, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto('login');
  await page.getByRole('button', { name: account }).waitFor();
  return { context, page, login: () => page.getByRole('button', { name: account }).click().then(() => page.waitForURL(URL_BASE)) };
}

/** El apartado de una página larga, por su título. */
const section = (page, title) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).last();
const closeDialog = (page) => page.getByRole('button', { name: 'Cerrar' }).first().click();

async function samplePdf(title, lines) {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const sheet = pdf.addPage([595, 842]);
  sheet.drawText('Construcciones Levante S.L.', { x: 60, y: 780, size: 11, font: regular });
  sheet.drawText(title, { x: 60, y: 740, size: 20, font: bold });
  lines.forEach((line, i) => sheet.drawText(line, { x: 60, y: 700 - i * 22, size: 12, font: regular }));
  return Buffer.from(await pdf.save());
}

async function drawSignature(page) {
  const pad = page.getByRole('img', { name: 'Lienzo de firma' });
  await pad.waitFor();
  await page.waitForTimeout(600);
  const box = await pad.boundingBox();
  const stroke = async (points) => {
    await page.mouse.move(box.x + points[0][0] * box.width, box.y + points[0][1] * box.height);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 3 });
    await page.mouse.up();
  };
  await stroke(Array.from({ length: 30 }, (_, i) => [0.15 + (i / 30) * 0.6, 0.55 + Math.sin(i / 3.2) * 0.2]));
  await stroke([[0.2, 0.8], [0.5, 0.76], [0.8, 0.82]]);
}

const DOC_TITLE = 'Entrega de equipos de protección';
let kioskCode = '';

// ───────────────────────── Administración (escritorio), primera parte ─────────────────────────
console.log('Administración: preparar documento, nóminas y quiosco');
const elena = await enter(/Elena Martín Soler/, desktop);
const d = elena.page;
await shot(d, 'd-acceso');
await elena.login();

await step('enviar documento a firmar', async () => {
  await d.goto('documents');
  await d.getByRole('button', { name: 'Enviar', exact: true }).click();
  await d.locator('input[type=file]').setInputFiles({
    name: 'entrega-epis.pdf',
    mimeType: 'application/pdf',
    buffer: await samplePdf('Entrega de equipos de protección individual', [
      'Se hace entrega del siguiente material, de uso obligatorio en la obra:',
      '  ·  Casco de seguridad con barboquejo',
      '  ·  Arnés anticaídas y línea de vida',
      '  ·  Botas de seguridad S3 y guantes de protección',
      'La persona trabajadora declara haberlo recibido en buen estado.',
    ]),
  });
  await d.getByLabel('Título').fill(DOC_TITLE);
  await d.getByLabel('Tipo de documento').selectOption({ label: 'Prevención de riesgos / EPIs' });
  await d.getByRole('checkbox', { name: /Luis Peña Gómez/ }).click();
  await d.getByRole('radio', { name: 'Firmar', exact: true }).click();
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await d.getByLabel('Fecha límite (opcional)').fill(due);
  await shot(d, 'd-documento-enviar');
  await d.getByRole('button', { name: 'Enviar', exact: true }).last().click();
  await d.getByText('Enviado a 1 persona').waitFor();
});

await step('nóminas por DNI', async () => {
  await d.goto('documents');
  await d.getByRole('link', { name: 'Enviar nóminas' }).click();
  const [file] = await Promise.all([d.waitForEvent('download'), d.getByRole('button', { name: 'Descargar un PDF de ejemplo' }).click()]);
  await d.locator('input[type=file]').setInputFiles({ name: 'nominas-ejemplo.pdf', mimeType: 'application/pdf', buffer: readFileSync(await file.path()) });
  await d.getByText(/DNI\/NIE \w+/).first().waitFor();
  await shot(d, 'd-nominas', { full: true });
  await d.getByRole('button', { name: 'Descartar' }).click();
});

await step('quiosco: alta y código', async () => {
  await d.goto('company');
  await d.getByLabel('Nombre del quiosco').fill('Tablet de la entrada');
  await d.getByRole('button', { name: 'Añadir quiosco' }).click();
  await d.getByRole('heading', { name: 'Empareja la tablet' }).waitFor();
  kioskCode = (await d.locator('dialog[open] p.font-mono.text-4xl').innerText()).trim();
  await shot(d, 'd-quiosco-codigo');
  await closeDialog(d);
});

// ───────────────────────────────── Trabajador (móvil) ─────────────────────────────────
console.log('Trabajador en el móvil');
const luis = await enter(/Luis Peña Gómez/, { ...phone, permissions: ['geolocation'], geolocation: { latitude: 39.4607, longitude: -0.3417 } });
const m = luis.page;
await shot(m, 'm-acceso');
await shot(m, 'm-acceso-completo', { full: true });
await luis.login();
await step('inicio', async () => {
  await m.getByRole('heading', { name: /Luis/ }).waitFor();
  await shot(m, 'm-inicio');
});

await step('situarse dentro de la obra', async () => {
  const [response] = await Promise.all([m.waitForResponse((r) => /\/api\/v1\/locations(\?|$)/.test(r.url()) && r.request().method() === 'GET'), m.goto('locations')]);
  const list = await response.json();
  const site = (Array.isArray(list) ? list : (list.items ?? [])).find((l) => /Puerto/.test(l.name));
  const latitude = site.latitude ?? site.lat;
  const longitude = site.longitude ?? site.lng ?? site.lon;
  await luis.context.setGeolocation({ latitude, longitude, accuracy: 8 });
  await m.getByText(/Obra Av. del Puerto/).first().waitFor();
  await m.waitForTimeout(2000);
  await shot(m, 'm-ubicaciones');
});

await step('fichar', async () => {
  await m.goto('clock');
  await m.getByRole('button', { name: 'Entendido' }).waitFor();
  await shot(m, 'm-aviso-ubicacion');
  await m.getByRole('button', { name: 'Entendido' }).click();
  await m.getByText(/Estás en /).waitFor();
  await shot(m, 'm-fichar-listo');

  await luis.context.setOffline(true);
  await m.getByText(/Sin conexión/).first().waitFor();
  await m.getByRole('button', { name: 'Iniciar jornada' }).click();
  await m.waitForTimeout(800);
  await shot(m, 'm-fichar-sin-conexion');
  await luis.context.setOffline(false);
  await m.getByRole('button', { name: 'Pausa' }).waitFor();
  // Al iniciar la jornada llegan las notas de relevo que esperaban.
  await m.getByTestId('handover-note').first().waitFor();
  await m.evaluate(() => scrollTo(0, 0));
  await shot(m, 'm-relevo-recibida');
  while (await m.getByTestId('handover-note').count()) {
    await m.getByTestId('handover-note').first().getByRole('button', { name: 'Entendido' }).click();
    await m.waitForTimeout(600);
  }
  await m.waitForTimeout(3000);
  await shot(m, 'm-fichar-trabajando');

  await m.getByRole('button', { name: 'Pausa' }).click();
  await m.getByText('¿Qué pausa es?').waitFor();
  await shot(m, 'm-fichar-pausa');
  await m.getByRole('button', { name: /Comida/ }).click();
  await m.getByRole('button', { name: 'Reanudar' }).waitFor();
  await shot(m, 'm-fichar-en-pausa');
  await m.getByRole('button', { name: 'Reanudar' }).click();
  await m.getByRole('button', { name: 'Finalizar' }).click();
  await m.getByText('¿Finalizar la jornada?').waitFor();
  await shot(m, 'm-fichar-finalizar');
  await m.getByLabel(/Nota de relevo/).fill('Dejo la hormigonera limpia. Faltan por recoger los puntales del forjado 2.');
  await shot(m, 'm-relevo-escribir');
  await m.getByRole('button', { name: 'Finalizar jornada' }).click();
  await m.getByRole('button', { name: 'Iniciar jornada' }).waitFor();
  await m.getByText('Notas que has dejado').scrollIntoViewIfNeeded();
  await m.evaluate(() => scrollBy(0, 200));
  await shot(m, 'm-relevo-enviada');
  await m.evaluate(() => scrollTo(0, 0));
});

await step('detalle y corrección de una jornada', async () => {
  await m.goto('clock');
  await m.getByRole('button', { name: /^mar, 10 nov|^lun, 9 nov/ }).first().click();
  await m.waitForTimeout(1200);
  await shot(m, 'm-jornada-detalle');
  await m.getByRole('button', { name: 'Corregir' }).click();
  await m.getByText('Corregir jornada').waitFor();
  await m.getByLabel('Motivo').fill('Olvidé finalizar y salí a las 16:00');
  await shot(m, 'm-jornada-corregir');
  await shot(m, 'm-jornada-corregir-completa', { of: m.locator('dialog[open]') });
});

await step('jornada a mano', async () => {
  await m.goto('clock');
  await m.getByRole('button', { name: 'Añadir jornada' }).click();
  await m.getByText('Jornada manual').waitFor();
  await shot(m, 'm-jornada-manual');
});

await step('horario', async () => {
  await m.goto('schedule');
  await m.getByText(/Libre/).first().waitFor();
  await shot(m, 'm-horario');
});

await step('ausencias', async () => {
  await m.goto('absences');
  await m.getByRole('button', { name: 'Pedir ausencia' }).waitFor();
  await shot(m, 'm-ausencias');
  await m.getByRole('button', { name: 'Pedir ausencia' }).click();
  await m.getByLabel('Comentario (opcional)').fill('Mudanza');
  await shot(m, 'm-ausencia-pedir');
});

await step('gastos', async () => {
  await m.goto('expenses');
  await m.getByRole('button', { name: 'Añadir gasto' }).first().waitFor();
  await shot(m, 'm-gastos');
  await m.getByRole('button', { name: 'Sin ticket' }).click();
  await m.getByLabel(/Importe total/).fill('14,80');
  await m.getByLabel('Comercio').fill('Bar La Obra');
  await shot(m, 'm-gasto-nuevo');
  await closeDialog(m);
  await m.getByRole('button', { name: /Ferretería Levante/ }).click();
  await shot(m, 'm-gasto-rechazado');
});

await step('documentos y firma', async () => {
  await m.goto('documents');
  await m.getByRole('link', { name: new RegExp(DOC_TITLE) }).waitFor();
  await shot(m, 'm-documentos');
  await m.getByRole('link', { name: new RegExp(DOC_TITLE) }).click();
  await m.locator('[data-pages] canvas').first().waitFor();
  await shot(m, 'm-documento-por-firmar');
  await m.getByRole('button', { name: 'Firmar documento' }).click();
  await drawSignature(m);
  await shot(m, 'm-documento-firma');
  await m.getByRole('button', { name: 'Firmar', exact: true }).click();
  await m.getByText('Documento firmado').waitFor();
  await m.waitForTimeout(2500);
  await shot(m, 'm-documento-firmado', { full: true });
});

await step('nómina', async () => {
  await m.goto('documents');
  await m.getByRole('link', { name: /Nómina de octubre/ }).click();
  await m.locator('[data-pages] canvas').first().waitFor();
  await shot(m, 'm-nomina');
});

await step('avisos', async () => {
  await m.goto('');
  await m.getByRole('button', { name: /^Avisos/ }).click();
  await m.getByText('Marcar todo como leído').waitFor();
  await shot(m, 'm-avisos');
});

await step('más y ajustes', async () => {
  await m.goto('more');
  await m.getByRole('link', { name: 'Ajustes' }).waitFor();
  await shot(m, 'm-mas');
  await m.goto('settings');
  await m.getByRole('heading', { name: 'PIN del quiosco' }).waitFor();
  await shot(m, 'm-ajustes');
  for (const [title, name] of [['Apariencia', 'm-ajustes-apariencia'], ['Notificaciones', 'm-ajustes-avisos'], ['PIN del quiosco', 'm-ajustes-pin'], ['Sesiones abiertas', 'm-ajustes-sesiones'], ['Privacidad y datos', 'm-ajustes-privacidad']]) {
    const part = section(m, title);
    await part.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot(m, name, { of: part });
  }
});
await luis.context.close();

// ───────────────────────────────── Quiosco (tablet) ─────────────────────────────────
console.log('Quiosco en la tablet');
await step('quiosco', async () => {
  const context = await browser.newContext(tabletOptions);
  const k = await context.newPage();
  await k.goto('kiosk');
  await k.getByRole('heading', { name: 'Emparejar esta tablet' }).waitFor();
  await k.getByLabel('Código de emparejamiento').fill(kioskCode);
  await shot(k, 'k-emparejar');
  await k.getByRole('button', { name: 'Emparejar' }).click();
  await k.getByRole('heading', { name: '¿Quién eres?' }).waitFor();
  await shot(k, 'k-quien-eres');
  await k.getByRole('button', { name: 'Ana Vidal Torres' }).click();
  await k.keyboard.type('12');
  await shot(k, 'k-pin');
  await k.keyboard.type('34');
  await k.keyboard.press('Enter');
  await k.getByRole('heading', { name: 'Hola, Ana Vidal Torres' }).waitFor();
  await shot(k, 'k-fichar');
  await k.getByRole('button', { name: 'Entrar' }).click();
  await k.getByRole('heading', { name: 'Entrada registrada' }).waitFor();
  await shot(k, 'k-entrada');
  await context.close();
});

// ───────────────────────── Administración (escritorio), segunda parte ─────────────────────────
console.log('Administración en el escritorio');
await step('inicio', async () => {
  await d.goto('');
  await d.getByRole('heading', { name: 'Tu equipo ahora' }).waitFor();
  await shot(d, 'd-inicio');
});

await step('fichajes', async () => {
  await d.goto('timesheets');
  await d.getByRole('button', { name: 'Día anterior' }).click();
  await d.getByRole('button', { name: /Luis Peña Gómez/ }).waitFor();
  await shot(d, 'd-fichajes-equipo');
  await d.getByRole('button', { name: /Luis Peña Gómez/ }).first().click();
  await d.waitForTimeout(1500);
  await shot(d, 'd-fichajes-detalle');
  await d.goto('timesheets');
  await d.getByRole('radio', { name: /Pendientes/ }).click();
  await d.getByRole('button', { name: 'Aprobar' }).first().waitFor();
  await shot(d, 'd-fichajes-pendientes');
  await d.getByRole('button', { name: 'Rechazar' }).first().click();
  await d.getByText('Rechazar jornada').waitFor();
  await shot(d, 'd-fichajes-rechazar');
  await d.goto('timesheets');
  await d.getByRole('radio', { name: 'Horas' }).click();
  await d.getByRole('table').waitFor();
  await shot(d, 'd-fichajes-horas');
});

await step('cuadrante', async () => {
  await d.goto('schedule');
  await d.getByRole('table').waitFor();
  await shot(d, 'd-cuadrante');
  const now = new Date();
  // Un día sin turno de la semana que se ve (de lunes a domingo): el sábado, o el propio domingo.
  const saturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (now.getDay() === 0 ? 0 : 6 - now.getDay()));
  await d.getByRole('button', { name: `Añadir turno a Ana Vidal Torres el día ${saturday.getDate()}` }).click({ force: true });
  await d.getByLabel('Nota para el empleado').fill('Traer el arnés');
  await shot(d, 'd-turno-nuevo');
  await closeDialog(d);
  await d.getByRole('radio', { name: 'Mes' }).click();
  await d.waitForTimeout(800);
  await shot(d, 'd-cuadrante-mes');
  await d.getByRole('button', { name: 'Turnos rotativos' }).click();
  await d.getByRole('button', { name: 'Aplicar' }).waitFor();
  await shot(d, 'd-rotativos');
  await d.getByRole('button', { name: 'Aplicar' }).click();
  await d.getByText('Desfase entre personas (días)').waitFor();
  await shot(d, 'd-rotativos-aplicar');
});

await step('ausencias', async () => {
  await d.goto('absences');
  await d.getByRole('button', { name: 'Aprobar' }).first().waitFor();
  await shot(d, 'd-ausencias-aprobar');
  await d.getByRole('radio', { name: 'Calendario' }).click();
  await d.getByRole('table').waitFor();
  await shot(d, 'd-ausencias-calendario');
});

await step('alertas', async () => {
  await d.goto('alerts');
  await d.getByRole('button', { name: 'Resolver' }).first().waitFor();
  await shot(d, 'd-alertas');
});

await step('gastos', async () => {
  await d.goto('expenses');
  await d.getByRole('radio', { name: /Por aprobar/ }).click();
  await d.locator('main li button').first().waitFor();
  await shot(d, 'd-gastos-aprobar');
  await d.locator('main li button').first().click();
  await d.waitForTimeout(1200);
  await shot(d, 'd-gasto-detalle');
  await closeDialog(d);
  await d.getByRole('radio', { name: 'Liquidación' }).click();
  await d.getByRole('button', { name: 'Marcar como pagado' }).first().waitFor();
  await shot(d, 'd-gastos-liquidacion');
  await d.getByRole('button', { name: 'Marcar como pagado' }).first().click();
  await d.getByText('Confirmar pago').waitFor();
  await shot(d, 'd-gastos-pago');
  await closeDialog(d);
  await d.getByRole('button', { name: 'Categorías' }).click();
  await d.getByText('Categorías propias').waitFor();
  await shot(d, 'd-gastos-categorias');
});

await step('documentos', async () => {
  await d.goto('documents');
  await d.getByRole('radio', { name: 'Enviados' }).click();
  await d.getByText(new RegExp(DOC_TITLE)).first().waitFor();
  await shot(d, 'd-documentos-enviados');
  await d.getByRole('button', { name: new RegExp(DOC_TITLE) }).first().click();
  await d.waitForTimeout(1200);
  await shot(d, 'd-documento-seguimiento');
  await d.goto('documents');
  await d.getByRole('button', { name: 'Registro mensual' }).click();
  await d.getByText('Enviar el registro de jornada').waitFor();
  await shot(d, 'd-registro-mensual');
});

await step('equipo', async () => {
  await d.goto('team');
  await d.getByRole('heading', { name: 'Departamentos' }).waitFor();
  await shot(d, 'd-equipo', { full: true });
  await d.getByRole('button', { name: 'Invitar' }).click();
  await d.getByLabel('Correo electrónico').fill('nueva.persona@ejemplo.es');
  await shot(d, 'd-invitar');
  await closeDialog(d);
  await d.getByRole('button', { name: 'Importar plantilla' }).click();
  await d.getByRole('button', { name: 'Descargar la plantilla' }).waitFor();
  await shot(d, 'd-importar');
  await closeDialog(d);
  await d.getByRole('button', { name: /Luis Peña Gómez/ }).click();
  await d.getByText('Gestionar miembro').waitFor();
  await shot(d, 'd-miembro');
  await closeDialog(d);
  await d.getByRole('button', { name: 'Responsables' }).first().click();
  await d.getByText(/Responsables de/).waitFor();
  await shot(d, 'd-departamento-responsables');
});

await step('ubicaciones', async () => {
  await d.goto('locations');
  await d.getByRole('link', { name: /Obra Av. del Puerto/ }).waitFor();
  await d.waitForTimeout(2500);
  await shot(d, 'd-ubicaciones');
  await d.getByRole('link', { name: /Obra Av. del Puerto/ }).click();
  await d.getByRole('heading', { name: 'Cartel con código QR' }).waitFor();
  await d.waitForTimeout(2500);
  await shot(d, 'd-ubicacion', { full: true });
});

await step('empresa', async () => {
  await d.goto('company');
  await d.getByRole('heading', { name: 'Quioscos de fichaje' }).waitFor();
  console.log('    apartados: ' + (await d.locator('main h2').allTextContents()).join(' | '));
  for (const [title, name] of [
    ['Marca de la empresa', 'd-empresa-marca'],
    ['Jornada y fichaje', 'd-empresa-jornada'],
    ['Alertas de jornada', 'd-empresa-alertas'],
    ['Registro mensual de jornada', 'd-empresa-registro'],
    ['Exportación para la gestoría', 'd-empresa-gestoria'],
    ['Gastos', 'd-empresa-gastos'],
    ['Privacidad y desconexión', 'd-empresa-privacidad'],
    ['Calendario laboral y vacaciones', 'd-empresa-calendario'],
    ['Festivos', 'd-empresa-festivos'],
    ['Quioscos de fichaje', 'd-empresa-quioscos'],
  ]) {
    await step(`empresa › ${title}`, async () => {
      const part = section(d, title);
      await part.evaluate((el) => el.scrollIntoView({ block: 'center' }), undefined, { timeout: 5000 });
      await shot(d, name, { of: part });
    });
  }
});

await step('informes y coste por obra', async () => {
  await d.goto('reports');
  await d.getByRole('heading', { name: 'Exportación para la gestoría' }).waitFor();
  await shot(d, 'd-informes', { full: true });
  await d.goto('sites');
  await d.getByRole('heading', { name: 'Desglose por ubicación' }).waitFor();
  await shot(d, 'd-coste-obra', { full: true });
});
await elena.context.close();

// ───────────────────────────── Responsable (móvil) ─────────────────────────────
console.log('Responsable en el móvil');
const javier = await enter(/Javier Ortega Ruiz/, phone);
await javier.login();
await step('responsable en el móvil', async () => {
  const j = javier.page;
  await j.getByRole('heading', { name: 'Tu equipo ahora' }).waitFor();
  await shot(j, 'm-responsable-inicio');
  await j.goto('more');
  await j.getByRole('link', { name: 'Equipo' }).waitFor();
  await shot(j, 'm-responsable-mas');
  await j.goto('timesheets');
  await j.getByRole('radio', { name: /Pendientes/ }).click();
  await j.getByRole('button', { name: 'Aprobar' }).first().waitFor();
  await shot(j, 'm-responsable-pendientes');
});
await javier.context.close();

await browser.close();
console.log(failures.length ? `\nHan fallado ${failures.length} pasos: ${failures.join(' · ')}` : '\nTodas las capturas hechas.');
process.exit(failures.length ? 1 : 0);
