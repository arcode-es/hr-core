import { expect, test } from '@playwright/test';
import { company } from './helpers';

test('jornada manual, aprobación, corrección rechazada, historial y corrección de la responsable', async ({ browser }) => {
  const { boss: d, worker: m } = await company(browser);

  // El empleado declara la jornada de ayer; sin motivo no se envía.
  await m.goto('/clock');
  await m.getByRole('button', { name: 'Añadir jornada' }).click();
  await m.getByLabel('Fin', { exact: true }).fill('16:30');
  await m.getByRole('button', { name: 'Añadir pausa' }).click();
  await m.getByRole('button', { name: 'Enviar para validar' }).click();
  await expect(m.getByRole('alert')).toBeVisible();
  await m.getByLabel('Motivo').fill('Olvidé fichar: el móvil se quedó sin batería');
  await m.getByRole('button', { name: 'Enviar para validar' }).click();
  await expect(m.getByText('Enviado a tu responsable')).toBeVisible();
  await expect(m.getByText('Pendiente', { exact: true })).toBeVisible();

  // La responsable la aprueba desde la bandeja.
  await d.goto('/timesheets');
  await expect(d.getByText('1 jornada pendiente de validar')).toBeVisible();
  await d.getByRole('radio', { name: /Pendientes/ }).click();
  await expect(d.getByText('Jornada manual')).toBeVisible();
  await d.getByRole('button', { name: 'Aprobar' }).click();
  await expect(d.getByText('Todo validado')).toBeVisible();

  // El empleado propone una corrección; la original sigue vigente mientras tanto.
  await m.reload();
  await expect(m.getByText('Manual', { exact: true })).toBeVisible();
  await m.getByRole('button', { expanded: false }).filter({ hasText: /min/ }).first().click();
  await m.getByRole('button', { name: 'Corregir' }).click();
  await m.getByLabel('Inicio', { exact: true }).fill('07:30');
  await m.getByLabel('Motivo').fill('Entré media hora antes para recibir material');
  await m.getByRole('button', { name: 'Enviar para validar' }).click();
  await expect(m.getByText('Corrección pendiente')).toBeVisible();

  // La responsable ve el antes y el después, y la rechaza con motivo.
  await d.reload();
  await d.getByRole('radio', { name: /Pendientes/ }).click();
  await expect(d.getByText('Antes', { exact: true })).toBeVisible();
  await expect(d.getByText('Ahora', { exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Rechazar' }).click();
  await d.getByPlaceholder('Explica por qué no es correcta').fill('El albarán de entrega marca las 08:05');
  await d.getByRole('button', { name: 'Rechazar' }).last().click();
  await expect(d.getByText('Jornada rechazada')).toBeVisible();

  // El empleado ve el motivo y el historial completo, agrupado por acto.
  await m.reload();
  await m.getByRole('button', { expanded: false }).filter({ hasText: 'Corrección rechazada' }).click();
  await expect(m.getByText(/El albarán de entrega/)).toBeVisible();
  await m.getByRole('button', { name: 'Historial' }).first().click();
  for (const step of ['Rechazado', 'Corrección introducida', 'Aprobado', 'Introducido a mano']) await expect(m.getByText(step, { exact: true })).toBeVisible();
  await m.getByRole('button', { name: 'Cerrar' }).click();

  // La responsable corrige directamente la jornada de ayer; el original queda anulado, no borrado.
  await d.getByRole('radio', { name: 'Equipo' }).click();
  await d.getByRole('button', { name: 'Día anterior' }).click();
  await d.getByRole('button', { name: /Luis Peña Soler/ }).click();
  await d.getByRole('button', { name: 'Corregir' }).click();
  await d.getByLabel('Fin', { exact: true }).fill('17:00');
  await d.getByLabel('Motivo').fill('Parte de obra firmado hasta las 17:00');
  await d.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(d.getByText('Jornada guardada')).toBeVisible();
  await d.getByRole('button', { name: /Luis Peña Soler/ }).click();
  await d.getByRole('button', { name: 'Historial' }).first().click();
  await expect(d.getByText('Registro original anulado').first()).toBeVisible();
});
