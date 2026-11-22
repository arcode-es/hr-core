import { expect, test } from '@playwright/test';
import { company, daysAgo } from './helpers';

test('cuadrante: crear, solape, publicar, copiar semana, agenda del empleado y bolsa de horas', async ({ browser }) => {
  const { boss: d, worker: m } = await company(browser);
  const today = new Date().getDate();

  await d.goto('/schedule');
  // Turno de hoy para Luis, de 00:00 a 23:59 para que esté «en curso» a cualquier hora del test.
  await d.getByRole('button', { name: `Añadir turno a Luis Peña Soler el día ${today}` }).click({ force: true });
  await d.getByLabel('Inicio', { exact: true }).fill('00:00');
  await d.getByLabel('Fin', { exact: true }).fill('23:59');
  await d.getByLabel('Pausa prevista').selectOption('0');
  await d.getByLabel('Nota para el empleado').fill('Traer arnés y casco');
  await d.getByRole('button', { name: 'Crear turno' }).click();
  await expect(d.getByText('Turno creado como borrador')).toBeVisible();

  // Un segundo turno que se solapa se rechaza.
  await d.getByRole('button', { name: `Añadir turno a Luis Peña Soler el día ${today}` }).click({ force: true });
  await d.getByRole('button', { name: 'Crear turno' }).click();
  await expect(d.getByText('Ese horario se solapa con otro ya existente.')).toBeVisible();
  await d.getByRole('button', { name: 'Cerrar' }).click();

  // Borrador: el empleado aún no lo ve.
  await m.goto('/schedule');
  await expect(m.getByText('Traer arnés y casco')).toHaveCount(0);

  await d.getByRole('button', { name: 'Publicar 1 borrador' }).click();
  await expect(d.getByText('1 turno publicado')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Todo publicado' })).toBeDisabled();

  // Copiar a la semana siguiente; repetirlo no duplica.
  await d.getByRole('button', { name: 'Siguiente' }).click();
  await d.getByRole('button', { name: 'Copiar semana anterior' }).click();
  await expect(d.getByText('1 turno copiado como borrador')).toBeVisible();
  await d.getByRole('button', { name: 'Copiar semana anterior' }).click();
  await expect(d.getByText('Esta semana ya tiene esos turnos.')).toBeVisible();
  await d.getByRole('button', { name: /00:00–23:59/ }).click();
  await d.getByRole('button', { name: 'Eliminar turno' }).click();
  await expect(d.getByText('Turno eliminado')).toBeVisible();

  // Agenda del empleado y turno en la pantalla de fichar.
  await m.reload();
  await expect(m.getByText('Traer arnés y casco')).toBeVisible();
  await m.goto('/clock');
  await expect(m.getByText('Turno 00:00 – 23:59')).toBeVisible();

  // Una jornada aprobada sin turno cuenta como extra en la bolsa de horas del equipo.
  await d.goto('/timesheets');
  await d.getByRole('button', { name: 'Día anterior' }).click();
  await d.getByRole('button', { name: /Luis Peña Soler/ }).click();
  await d.getByRole('button', { name: 'Añadir jornada' }).click();
  await expect(d.getByLabel('Fecha')).toHaveValue(daysAgo(1));
  await d.getByLabel('Motivo').fill('Parte firmado en papel');
  await d.getByRole('button', { name: 'Guardar jornada' }).click();
  await expect(d.getByText('Jornada guardada')).toBeVisible();
  await d.getByRole('radio', { name: 'Horas' }).click();
  const row = d.getByRole('row', { name: /Luis Peña Soler/ });
  await expect(row).toContainText('8 h');
});
