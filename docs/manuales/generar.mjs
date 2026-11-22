/**
 * Monta los tres manuales, uno por perfil (HTML) y los imprime en PDF con Chromium.
 *
 *   node docs/manuales/generar.mjs
 *
 * El texto está en contenido/, las capturas en capturas/ (las hace capturas.mjs) y el diseño en manual.css.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { capitulosTrabajador } from './contenido/trabajador.mjs';
import { capitulosGestion } from './contenido/responsable.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../apps/e2e/package.json'));
const { chromium } = require('@playwright/test');

const DEMO = 'https://arcode.es/HR-core/demo';
const edition = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(new Date());

const manuals = [
  {
    file: 'manual-trabajadores',
    kind: 'Manual para trabajadores',
    title: 'Tu jornada, tus gastos y tus documentos, en el móvil',
    intro: 'Cómo fichar, consultar tu horario, pedir vacaciones, enviar gastos y firmar documentos con HR-Core.',
    parts: [{ chapters: capitulosTrabajador }],
  },
  {
    file: 'manual-responsables',
    kind: 'Manual para responsables',
    title: 'Gestionar el equipo con HR-Core',
    intro: 'Validar jornadas, planificar turnos, aprobar ausencias y gastos, enviar documentos y nóminas, y sacar los informes de tu equipo.',
    parts: [
      { name: 'Primera parte', title: 'El día a día de cualquier persona', lead: 'Lo que hace toda la plantilla, también quien gestiona: fichar, horario, ausencias, gastos y documentos.', chapters: capitulosTrabajador },
      { name: 'Segunda parte', title: 'Gestionar el equipo', lead: 'Lo que añade el perfil de Responsable.', chapters: capitulosGestion.filter((c) => c.id !== 'empresa') },
    ],
  },
  {
    file: 'manual-administracion',
    kind: 'Manual para administración',
    title: 'Gestionar el equipo y la empresa con HR-Core',
    intro: 'Validar jornadas, planificar turnos, aprobar ausencias y gastos, enviar documentos y nóminas, y configurar la empresa.',
    parts: [
      { name: 'Primera parte', title: 'El día a día de cualquier persona', lead: 'Lo que hace toda la plantilla, también quien gestiona: fichar, horario, ausencias, gastos y documentos.', chapters: capitulosTrabajador },
      { name: 'Segunda parte', title: 'Gestionar el equipo y la empresa', lead: 'Lo que añaden los perfiles de Responsable y Administración.', chapters: capitulosGestion },
    ],
  },
];

function build(manual) {
  const all = manual.parts.flatMap((p) => p.chapters);
  const number = new Map(all.map((c, i) => [c.id, i + 1]));
  const ref = (html) =>
    html.replace(/\{\{cap:([\w-]+)\}\}/g, (_, id) => {
      if (!number.has(id)) throw new Error(`${manual.file}: no existe el capítulo «${id}»`);
      return number.get(id);
    });

  const index = manual.parts
    .map(
      (part) =>
        (part.name ? `<p class="parte">${part.name} · ${part.title}</p>` : '') +
        `<ol>${part.chapters
          .map((c) => `<li><a href="#${c.id}"><span class="n">${number.get(c.id)}</span><span class="t">${c.title}</span><span class="d">${c.lead}</span></a></li>`)
          .join('')}</ol>`,
    )
    .join('');

  const body = manual.parts
    .map(
      (part) =>
        (part.name ? `<section class="separador"><span>${part.name}</span><h2>${part.title}</h2><p>${part.lead}</p></section>` : '') +
        part.chapters
          .map(
            (c) =>
              `<section class="capitulo" id="${c.id}"><header><span class="n">Capítulo ${number.get(c.id)}</span><h2>${c.title}</h2><p>${c.lead}</p></header>${ref(c.html)}</section>`,
          )
          .join(''),
    )
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>HR-Core · ${manual.kind}</title>
<link rel="stylesheet" href="manual.css">
</head>
<body>
<section class="portada">
  <div class="logo"><img src="../../apps/web/public/icon-192.png" alt="">HR-Core</div>
  <p class="tipo">${manual.kind}</p>
  <h1>${manual.title}</h1>
  <p class="entrada">${manual.intro}</p>
  <div class="pie"><div><b>Control horario, gastos y documentos</b>Edición de ${edition}</div><div><b>Demo</b>${DEMO.replace('https://', '')}</div></div>
</section>
<section class="indice"><h2>Contenido</h2>${index}</section>
${body}
<section class="contra">
  <img src="../../apps/web/public/icon-192.png" alt="">
  <h2>HR-Core</h2>
  <p>Pruébalo sin registrarte en <a href="${DEMO}">${DEMO.replace('https://', '')}</a><br>Las capturas de este manual están hechas sobre esa demo, con datos ficticios.</p>
  <p>Más información y tarifas en <a href="https://arcode.es/HR-core">arcode.es/HR-core</a><br>Un producto de ARcode · <a href="https://arcode.es">arcode.es</a></p>
</section>
</body>
</html>`;
}

const browser = await chromium.launch();
for (const manual of manuals) {
  const html = join(here, `${manual.file}.html`);
  writeFileSync(html, build(manual));
  const page = await browser.newPage();
  await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' });
  await page.pdf({ path: join(here, `${manual.file}.pdf`), preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
  await page.close();
  console.log(`✓ ${manual.file}.pdf`);
}
await browser.close();
