/*
 * Entorno de los tests de la API. Sin tareas programadas (los tests las disparan
 * a mano con JobsService.tick) y sin exigir verificación del correo, salvo en los
 * tests que lo prueban expresamente.
 */
process.env.JOBS_ENABLED ??= 'false';
process.env.EMAIL_VERIFICATION ??= 'off';

// Las pruebas de push necesitan un par de claves VAPID válido: si el entorno no trae
// uno, se genera aquí (solo vive lo que dura la ejecución).
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const keys = (require('web-push') as typeof import('web-push')).generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
}
