import { type Browser, type BrowserContext, devices, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

export const API = 'http://localhost:3000/api/v1';
export const PASSWORD = 'secreto-1234';

export interface Person {
  name: string;
  email: string;
}

const tag = (): string => Math.random().toString(36).slice(2, 9);
export const person = (name: string): Person => ({ name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${tag()}@e2e.dev` });

/** Falla el test si la página lanza un error de JavaScript: un recorrido «verde» con errores en consola no vale. */
export function failOnPageErrors(page: Page): void {
  page.on('pageerror', (e) => {
    throw new Error(`Error en la página: ${e.message}`);
  });
}

export const phone = { ...devices['iPhone 14'], locale: 'es-ES', timezoneId: 'Europe/Madrid' };
export const desktop = { viewport: { width: 1280, height: 900 }, locale: 'es-ES', timezoneId: 'Europe/Madrid' };

export async function register(page: Page, who: Person): Promise<void> {
  if (!page.url().includes('/register')) await page.goto('/register');
  await page.getByLabel('Nombre y apellidos').fill(who.name);
  if (!(await page.getByLabel('Correo electrónico').inputValue())) await page.getByLabel('Correo electrónico').fill(who.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

/** Llamada directa a la API con la sesión de la página, para preparar datos sin pasar por la interfaz. */
export async function apiCall<T>(page: Page, method: string, path: string, body?: unknown, workspace?: string): Promise<T> {
  return page.evaluate(
    async ({ api, method, path, body, workspace }) => {
      const refreshed = await fetch(`${api}/auth/refresh`, { method: 'POST', credentials: 'include' });
      const { accessToken } = await refreshed.json();
      const res = await fetch(`${api}${path}`, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(workspace ? { 'X-Workspace': workspace } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
      return res.status === 204 ? null : res.json();
    },
    { api: API, method, path, body, workspace },
  ) as Promise<T>;
}

export interface Company {
  boss: Page;
  worker: Page;
  bossContext: BrowserContext;
  workerContext: BrowserContext;
  bossPerson: Person;
  workerPerson: Person;
  orgId: string;
  workerId: string;
}

/**
 * Punto de partida de casi todos los recorridos: una responsable en escritorio
 * que crea su empresa e invita a un empleado, que se une desde el móvil.
 */
/**
 * Empresa con una responsable y un empleado. Por defecto ambos ya han leído el aviso de
 * geolocalización, para que los recorridos de fichaje vayan directos a fichar.
 */
export async function company(browser: Browser, workerOptions: object = {}, { acceptGeoNotice = true }: { acceptGeoNotice?: boolean } = {}): Promise<Company> {
  const bossPerson = person('Marta Ruiz Ortega');
  const workerPerson = person('Luis Peña Soler');
  const bossContext = await browser.newContext(desktop);
  const boss = await bossContext.newPage();
  failOnPageErrors(boss);
  await register(boss, bossPerson);
  await expect(boss.getByRole('heading', { name: /Marta/ })).toBeVisible();
  await boss.getByRole('button', { name: /Crea o únete a una empresa/ }).click();
  await boss.getByLabel('Nombre de la empresa').fill('Reformas Ortega S.L.');
  await boss.getByRole('button', { name: 'Crear empresa' }).click();
  await expect(boss.getByText('Invita a tu equipo')).toBeVisible();

  await boss.goto('/team');
  await boss.getByRole('button', { name: 'Invitar' }).first().click();
  await boss.getByLabel('Correo electrónico').fill(workerPerson.email);
  await boss.getByRole('button', { name: 'Crear enlace de invitación' }).click();
  const link = new URL((await boss.locator('output').innerText()).trim());
  await boss.getByRole('button', { name: 'Hecho' }).click();

  const workerContext = await browser.newContext({ ...phone, ...workerOptions });
  const worker = await workerContext.newPage();
  failOnPageErrors(worker);
  await worker.goto(link.pathname);
  await worker.getByRole('link', { name: 'Crear cuenta' }).click();
  await register(worker, workerPerson);
  await worker.getByRole('button', { name: /Unirme a/ }).click();
  await expect(worker.getByRole('heading', { name: /Luis/ })).toBeVisible();

  const me = await apiCall<{ user: { id: string }; workspaces: { organizationId?: string }[] }>(worker, 'GET', '/me');
  const orgId = me.workspaces.find((w) => w.organizationId)!.organizationId!;
  if (acceptGeoNotice) {
    await apiCall(worker, 'POST', '/time/geo-notice', undefined, orgId);
    await apiCall(boss, 'POST', '/time/geo-notice', undefined, orgId);
    // La app carga el estado del aviso al entrar: se recarga para que lo vea.
    await worker.reload();
    await boss.reload();
    await expect(worker.getByRole('heading', { name: /Luis/ })).toBeVisible();
  }
  return { boss, worker, bossContext, workerContext, bossPerson, workerPerson, orgId, workerId: me.user.id };
}

/** PDF de una página con un título, para enviar como documento. */
export async function samplePdf(title: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.addPage([595, 842]).drawText(title, { x: 60, y: 760, size: 22, font });
  return Buffer.from(await pdf.save());
}

/** Una «foto» JPEG cualquiera: lo que devolvería la cámara del móvil. */
export const samplePhoto = (page: Page): Promise<Buffer> => page.screenshot({ type: 'jpeg', quality: 70 });

/** Dibuja una rúbrica de dos trazos en el lienzo de firma. */
export async function drawSignature(page: Page): Promise<void> {
  const pad = page.getByRole('img', { name: 'Lienzo de firma' });
  await expect(pad).toBeVisible();
  await page.waitForTimeout(600); // la hoja termina de deslizarse antes de medir el lienzo
  const box = (await pad.boundingBox())!;
  const stroke = async (points: [number, number][]): Promise<void> => {
    await page.mouse.move(box.x + points[0]![0] * box.width, box.y + points[0]![1] * box.height);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 3 });
    await page.mouse.up();
  };
  await stroke(Array.from({ length: 30 }, (_, i) => [0.15 + (i / 30) * 0.6, 0.55 + Math.sin(i / 3.2) * 0.2] as [number, number]));
  await stroke([[0.2, 0.8], [0.5, 0.76], [0.8, 0.82]]);
}

/** Fecha local YYYY-MM-DD de hace `days` días. */
export function daysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface SentMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  tag: string;
}

/** Último correo enviado a una dirección (los deja la API en modo EMAIL_DRIVER=log). */
export async function lastMailTo(to: string): Promise<SentMail> {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, resolve } = await import('node:path');
  const dir = resolve(__dirname, '../test-results/.mail');
  for (let i = 0; i < 40; i++) {
    const found = readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile())
      .map((f) => f.name)
      .sort()
      .reverse()
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as SentMail)
      .find((m) => m.to === to);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No ha llegado ningún correo a ${to}`);
}

/** Enlace del botón principal de un correo, convertido en ruta relativa de la app. */
export function linkIn(mail: SentMail, path: string): string {
  const url = new RegExp(`https?://[^\\s]+${path}[^\\s]*`).exec(mail.text)?.[0];
  if (!url) throw new Error(`El correo «${mail.subject}» no contiene un enlace a ${path}`);
  return new URL(url).pathname + new URL(url).search;
}
