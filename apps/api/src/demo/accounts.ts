import type { DemoAccount } from '@hr/shared';

/** Nombre de la empresa ficticia de la demo. */
export const DEMO_ORGANIZATION = { name: 'Construcciones Levante S.L.', taxId: 'B00000000' };

/**
 * Dominio de las cuentas de la demo (DEMO_EMAIL_DOMAIN). Por defecto example.com, reservado para
 * ejemplos: aunque algo intentara escribir a estas direcciones, no llegaría a nadie.
 */
export const DEMO_EMAIL_DOMAIN = (process.env.DEMO_EMAIL_DOMAIN || 'demo.example.com').toLowerCase();
const at = (user: string): string => `${user}@${DEMO_EMAIL_DOMAIN}`;

/** Cuentas de la demo. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { role: 'ADMIN', email: at('administracion'), fullName: 'Elena Martín Soler' },
  { role: 'MANAGER', email: at('responsable'), fullName: 'Javier Ortega Ruiz' },
  { role: 'EMPLOYEE', email: at('empleado'), fullName: 'Luis Peña Gómez' },
  { role: 'EMPLOYEE', email: at('empleada'), fullName: 'Ana Vidal Torres' },
  { role: 'INSPECTOR', email: at('inspeccion'), fullName: 'Carmen Sanz Prieto' },
];

/** PIN del quiosco de todas las cuentas de la demo (salvo la de inspección, que no ficha). */
export const DEMO_KIOSK_PIN = '1234';

export const isDemoAccount = (email: string): boolean => DEMO_ACCOUNTS.some((a) => a.email === email.toLowerCase());
