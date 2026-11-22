import { expect, test } from '@playwright/test';
import AxeBuilder from './axe';
import { company } from './helpers';

/** Lunes de la semana que viene, y los días siguientes, en AAAA-MM-DD (hora local). */
function nextWeek(): string[] {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return [0, 1, 2, 3, 4].map((i) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  });
}

test('vacaciones: festivo local, solicitud que descuenta laborables, aprobación, saldo y cuadrante', async ({ browser }) => {
  const { boss, worker, workerPerson } = await company(browser);
  const [mon, , wed, , fri] = nextWeek() as [string, string, string, string, string];

  // La empresa: 23 días de vacaciones y un festivo local el miércoles de la semana que viene.
  await boss.goto('/company');
  await boss.getByLabel('Días de vacaciones al año').fill('23');
  await boss.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(boss.getByText('Ajustes de empresa guardados')).toBeVisible();
  const [year] = mon.split('-');
  if (year !== String(new Date().getFullYear())) await boss.getByRole('button', { name: 'Año siguiente' }).click();
  await boss.getByLabel('Fecha', { exact: true }).fill(wed);
  await boss.getByLabel('Nombre', { exact: true }).fill('Fiesta del pueblo');
  await boss.getByRole('button', { name: 'Añadir festivo' }).click();
  await expect(boss.getByText('Festivo añadido')).toBeVisible();
  await expect(boss.getByText('Fiesta del pueblo')).toBeVisible();

  // El empleado pide la semana entera: el festivo no cuenta.
  await worker.goto('/absences');
  await expect(worker.getByText('Vacaciones de', { exact: false }).first()).toBeVisible();
  await expect(worker.getByText('de 23 días')).toBeVisible();
  await worker.getByRole('button', { name: 'Pedir ausencia' }).click();
  await worker.getByLabel('Desde').fill(mon);
  await worker.getByLabel('Hasta').fill(fri);
  await expect(worker.getByText('Consume 4 días')).toBeVisible();
  await expect(worker.getByText('Te quedarán 19 días de vacaciones.')).toBeVisible();
  await worker.getByLabel('Comentario (opcional)').fill('Viaje familiar');
  await worker.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(worker.getByText('Solicitud enviada')).toBeVisible();
  await expect(worker.getByText('Pendiente', { exact: true })).toBeVisible();

  // La responsable la ve por aprobar y la aprueba.
  await boss.goto('/absences');
  await expect(boss.getByText(workerPerson.name)).toBeVisible();
  await expect(boss.getByText('Viaje familiar')).toBeVisible();
  await boss.waitForTimeout(600);
  expect(await AxeBuilder(boss)).toEqual([]);
  await boss.getByRole('button', { name: 'Aprobar' }).click();
  await expect(boss.getByText('Ausencia aprobada')).toBeVisible();
  await expect(boss.getByText('Nada por aprobar')).toBeVisible();

  // En el calendario del equipo y en el cuadrante.
  await boss.getByRole('radio', { name: 'Calendario' }).click();
  await expect(boss.getByRole('table', { name: 'Ausencias del equipo por día' })).toBeVisible();
  await boss.goto('/schedule');
  await boss.getByRole('button', { name: 'Siguiente' }).click();
  await expect(boss.getByRole('columnheader', { name: /Fiesta del pueblo/ })).toBeVisible();
  await expect(boss.getByText('Vacaciones').first()).toBeVisible();

  // El saldo del empleado ya descuenta los 4 días.
  await worker.reload();
  await expect(worker.getByText('Aprobada', { exact: true })).toBeVisible();
  await expect(worker.getByText('de 23 días')).toBeVisible();
  await expect(worker.locator('p', { hasText: 'de 23 días' })).toContainText('19');
  await worker.waitForTimeout(600);
  expect(await AxeBuilder(worker)).toEqual([]);
});
