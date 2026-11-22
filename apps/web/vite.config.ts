import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Las mismas cabeceras que nginx en producción, para que la vista previa (y los tests) cumplan la misma
 * política. En producción la API comparte origen con la web; en local está en otro puerto, así que su
 * origen se añade a connect-src (llamadas) e img-src (fotos servidas por la API).
 */
function securityHeaders(apiUrl: string | undefined): Record<string, string> {
  const conf = readFileSync(new URL('./security-headers.conf', import.meta.url), 'utf8');
  const headers = Object.fromEntries([...conf.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"/gm)].map((m) => [m[1]!, m[2]!]));
  const apiOrigin = apiUrl && /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : null;
  if (apiOrigin) {
    headers['Content-Security-Policy'] = headers['Content-Security-Policy']!.replace(/(connect-src|img-src) ([^;]*)/g, `$1 $2 ${apiOrigin}`);
  }
  return headers;
}

export default defineConfig(({ mode }) => {
  // Ruta donde se publica la app (p. ej. /HR-core). Vacía = raíz del dominio.
  const basePath = (process.env.VITE_BASE_PATH ?? loadEnv(mode, '../..', 'VITE_').VITE_BASE_PATH ?? '').replace(/\/+$/, '');
  const base = `${basePath}/`;
  const apiUrl = process.env.VITE_API_URL ?? loadEnv(mode, '../..', 'VITE_').VITE_API_URL;
  // Nombre del producto en esta instalación (marca del cliente); HR-Core si no se indica.
  const appName = process.env.VITE_APP_NAME ?? loadEnv(mode, '../..', 'VITE_').VITE_APP_NAME ?? 'HR-Core';
  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      { name: 'app-name', transformIndexHtml: (html: string) => html.replace(/<title>[^<]*<\/title>/, `<title>${appName.replace(/[<&]/g, '')}</title>`) },
      // App instalable que abre sin red: el service worker guarda la aplicación
      // (no los datos). Los datos sin conexión los gestiona la cola de src/lib/outbox.ts.
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: appName,
          short_name: appName.slice(0, 12),
          description: 'Control horario, gastos y documentos',
          lang: 'es',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#000409',
          theme_color: '#000409',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            { name: 'Fichar', url: `${base}clock` },
            { name: 'Añadir gasto', url: `${base}expenses` },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
          // config.js lo escribe el contenedor al arrancar: se pide a la red y solo sin conexión se usa el guardado.
          globIgnores: ['config.js'],
          runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.endsWith('/config.js'), handler: 'NetworkFirst', options: { cacheName: 'hr-config', networkTimeoutSeconds: 3 } }],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Cualquier ruta de la app se resuelve con el index guardado; la API nunca.
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [new RegExp(`^${base}api/`), new RegExp(`^${base}manuales/`)],
          cleanupOutdatedCaches: true,
          // Manejo de notificaciones push (public/push-sw.js).
          importScripts: ['push-sw.js'],
        },
      }),
    ],
    envDir: '../..',
    server: { port: 5173, host: true },
    preview: {
      port: 4173,
      host: true,
      headers: securityHeaders(apiUrl),
      // Como el proxy de producción: <ruta base>/api → la API, quitando la ruta base (lo usan los tests de la demo).
      proxy: process.env.PREVIEW_API_PROXY
        ? { [`${base}api`]: { target: process.env.PREVIEW_API_PROXY, changeOrigin: true, rewrite: (path: string) => path.slice(basePath.length) } }
        : undefined,
    },
  };
});
