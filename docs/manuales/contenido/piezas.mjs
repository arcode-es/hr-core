/** Piezas de maquetación que usan los capítulos de los dos manuales. */

/** Una o varias capturas de móvil en fila: [archivo, pie]. */
export const movil = (...shots) =>
  `<div class="moviles n${shots.length}">${shots
    .map(([file, caption]) => `<figure class="movil"><div class="marco"><img src="capturas/${file}.jpg" alt=""></div><figcaption>${caption}</figcaption></figure>`)
    .join('')}</div>`;

/** Captura de escritorio o de tablet a todo el ancho. */
export const pantalla = (file, caption, kind = '') =>
  `<figure class="pantalla ${kind}"><div class="marco"><img src="capturas/${file}.jpg" alt=""></div><figcaption>${caption}</figcaption></figure>`;

/** Recorte de un apartado de una página. */
export const recorte = (file, caption, kind = '') =>
  `<figure class="recorte ${kind}"><div class="marco"><img src="capturas/${file}.jpg" alt=""></div><figcaption>${caption}</figcaption></figure>`;

export const pasos = (...items) => `<ol class="pasos">${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
export const lista = (...items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
export const nota = (html, kind = 'info') =>
  `<aside class="nota ${kind}"><strong>${{ info: 'Para saber', ojo: 'Importante', truco: 'Consejo', demo: 'En la demo' }[kind]}</strong><p>${html}</p></aside>`;
export const tabla = (head, rows) =>
  `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
/** Nombre de un botón o de una opción de la app. */
export const b = (text) => `<span class="boton">${text}</span>`;
