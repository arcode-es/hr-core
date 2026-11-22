import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * Recorridos completos contra la aplicación compilada (con su service worker) y la API real.
 *
 *   pnpm build && pnpm db:deploy     # una vez
 *   pnpm e2e                         # arranca API y web si no lo están
 *
 * No dependen de internet: no usan mapas ni el geocodificador.
 */
const API = 'http://localhost:3000';
const WEB = 'http://localhost:4173';
/** La demo publicada bajo una ruta: modo demo, ruta base /HR-core y un proxy delante de la API. */
const DEMO_API = 'http://localhost:3001';
export const DEMO_WEB = 'http://localhost:4174/HR-core/';
export const DEMO_PASSWORD = 'Demo-HRCore-2026';
export const MAIL_DIR = resolve(__dirname, 'test-results/.mail');

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: WEB,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    colorScheme: 'light',
    trace: 'off',
    screenshot: 'only-on-failure',
    // Sin configuración regional UTF-8, Chromium descarta los nombres de descarga con tildes («nómina.pdf»).
    launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } },
  },
  webServer: [
    {
      command: 'pnpm --filter @hr/api start',
      url: `${API}/api/v1/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      // Los tests crean muchas cuentas seguidas desde una sola IP: se relajan los límites solo aquí.
      env: {
        RATE_LIMIT_PER_MINUTE: '100000',
        AUTH_RATE_LIMIT_PER_MINUTE: '100000',
        CORS_ORIGINS: `${WEB},http://localhost:5173`,
        // Los correos no se envían: se dejan en esta carpeta para que los tests lean los enlaces.
        EMAIL_DRIVER: 'log',
        EMAIL_LOG_DIR: MAIL_DIR,
        APP_PUBLIC_URL: WEB,
        DEPLOY_MODE: 'open',
        EMAIL_VERIFICATION: 'off',
        JOBS_ENABLED: 'false',
      },
    },
    { command: 'pnpm --filter @hr/web preview', url: WEB, reuseExistingServer: true, timeout: 60_000 },
    {
      // Deja la demo recién sembrada y arranca la API en modo demo.
      command: 'pnpm --filter @hr/api exec node dist/cli.js demo-reset && pnpm --filter @hr/api start',
      url: `${DEMO_API}/api/v1/health`,
      reuseExistingServer: true,
      timeout: 90_000,
      env: {
        API_PORT: '3001',
        DEPLOY_MODE: 'demo',
        BASE_PATH: '/HR-core',
        DEMO_PASSWORD,
        JOBS_ENABLED: 'false',
        RATE_LIMIT_PER_MINUTE: '100000',
        AUTH_RATE_LIMIT_PER_MINUTE: '100000',
        CORS_ORIGINS: 'http://localhost:4174',
        APP_PUBLIC_URL: DEMO_WEB,
        EMAIL_DRIVER: 'log',
      },
    },
    {
      // La web compilada para /HR-core, con la API en la misma ruta, como en producción.
      command:
        'pnpm --filter @hr/web exec vite build --outDir dist-demo --emptyOutDir && pnpm --filter @hr/web exec vite preview --outDir dist-demo --port 4174 --strictPort',
      url: DEMO_WEB,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { VITE_BASE_PATH: '/HR-core', VITE_API_URL: '/HR-core/api/v1', PREVIEW_API_PROXY: DEMO_API },
    },
  ],
});
