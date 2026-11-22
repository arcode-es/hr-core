# Manuales de HR-Core

| Archivo | Para quién |
|---|---|
| [manual-trabajadores.pdf](manual-trabajadores.pdf) | Toda la plantilla: entrar, fichar, horario, ausencias, gastos, documentos y ajustes |
| [manual-responsables.pdf](manual-responsables.pdf) | Responsables: lo anterior y la gestión de su equipo |
| [manual-administracion.pdf](manual-administracion.pdf) | Administración: todo lo anterior y la configuración de la empresa |

## Cómo están hechos

- `contenido/trabajador.mjs` y `contenido/responsable.mjs`: el texto, por capítulos. El manual de responsables
  incluye también los capítulos del trabajador. Las referencias entre capítulos se escriben `{{cap:id}}` y se
  numeran solas.
- `contenido/piezas.mjs`: las piezas de maquetación (capturas de móvil, de escritorio, notas, pasos, tablas).
- `manual.css`: el diseño (A4, portada, índice, capítulos), con el sistema de `docs/diseno/SISTEMA.md`.
- `capturas.mjs`: hace las capturas con Playwright sobre la demo, en móvil, tablet y escritorio → `capturas/`.
- `generar.mjs`: monta `manual-*.html` y los imprime en PDF con Chromium.

## Regenerarlos

Hace falta haber instalado las dependencias (`pnpm install`) y el Chromium de Playwright
(`pnpm --filter e2e exec playwright install chromium`).

```bash
# 1. Solo si ha cambiado la interfaz: repetir las capturas (unos 3 minutos).
#    Parte de la demo recién restablecida y vuelve a restablecerla después, porque deja datos de prueba.
docker compose exec api node dist/cli.js demo-reset        # en el servidor de la demo
node docs/manuales/capturas.mjs                            # PROD_URL=… para otra instalación en modo demo (o una local)
docker compose exec api node dist/cli.js demo-reset

# 2. Montar los PDF
node docs/manuales/generar.mjs
```

Las pantallas que no se pueden capturar de forma automática (escanear el QR, la foto al fichar, la instalación
en el móvil y «Avisos por correo», que la demo oculta porque no envía correos) se explican solo con texto.
