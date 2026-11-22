import { expect, test } from '@playwright/test';
import { company } from './helpers';

// Sin internet no hay teselas ni direcciones: el editor debe funcionar igual tocando el mapa.
test('ubicaciones: crear con el GPS y tocando el mapa, validar, editar, desactivar y separar espacios', async ({ browser }) => {
  const c = await company(browser, { geolocation: { latitude: 39.4699, longitude: -0.3763, accuracy: 10 }, permissions: ['geolocation'] });
  const m = c.boss;

  // La responsable no tiene permiso de ubicación: sitúa el punto tocando el mapa.
  await m.goto('/locations');
  await expect(m.getByText('Sin ubicaciones todavía')).toBeVisible();
  await m.getByRole('link', { name: 'Nueva' }).click();
  await expect(m.getByText('Toca el mapa para situar la ubicación')).toBeVisible();
  await expect(m.getByRole('button', { name: 'Crear ubicación' })).toBeDisabled();
  await m.getByRole('application', { name: 'Mapa de ubicaciones' }).click({ position: { x: 300, y: 200 } });
  await expect(m.getByText('Toca el mapa para situar la ubicación')).toHaveCount(0);
  await m.getByRole('button', { name: 'Crear ubicación' }).click();
  await expect(m.getByText('Demasiado corto')).toBeVisible();
  await m.getByLabel('Nombre').fill('Almacén');
  await m.getByRole('button', { name: '500 m' }).click();
  await m.getByRole('radio', { name: 'Color 3' }).click();
  await m.getByRole('button', { name: 'Crear ubicación' }).click();
  await expect(m.getByText('1 ubicación activa')).toBeVisible();
  await expect(m.getByText('Radio 500 m')).toBeVisible();

  // Editar: el radio se conserva; desactivar la deja en la lista, señalada.
  await m.getByRole('link', { name: /Almacén/ }).click();
  await expect(m.getByLabel('Radio del perímetro')).toHaveValue('500');
  await m.getByRole('switch').uncheck({ force: true });
  await m.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(m.getByText('Inactiva')).toBeVisible();
  await expect(m.getByText('0 ubicaciones activas')).toBeVisible();

  // El empleado, con GPS concedido, crea una personal: empieza donde está.
  const w = c.worker;
  await w.getByRole('button', { name: /Cambiar de espacio/ }).click();
  await w.getByRole('button', { name: /Personal/ }).click();
  await w.goto('/locations/new');
  await expect(w.getByText('Toca el mapa para situar la ubicación')).toHaveCount(0, { timeout: 15_000 });
  await w.getByLabel('Nombre').fill('Mi casa');
  await w.getByRole('button', { name: 'Crear ubicación' }).click();
  await expect(w.getByText('Mi casa')).toBeVisible();
  await expect(w.getByText('Almacén')).toHaveCount(0);

  // En la empresa, el empleado solo ve las activas y no puede crear.
  await w.getByRole('button', { name: /Cambiar de espacio/ }).click();
  await w.getByRole('button', { name: /Reformas Ortega/ }).click();
  await expect(w.getByText('Tu responsable aún no ha dado de alta ninguna ubicación.')).toBeVisible();
  await expect(w.getByRole('link', { name: 'Nueva' })).toHaveCount(0);
});
