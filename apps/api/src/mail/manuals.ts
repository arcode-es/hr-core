import type { Role } from '@hr/shared';
import { MailService } from './mail.service';
import { manualEmail } from './templates';

/** Manual (PDF servido por la web en /manuales) que corresponde a cada perfil. */
const FILE: Record<Role, string> = {
  EMPLOYEE: 'manual-trabajadores.pdf',
  MANAGER: 'manual-responsables.pdf',
  ADMIN: 'manual-administracion.pdf',
  // Quien solo consulta ve lo mismo que un responsable, sin poder cambiarlo.
  INSPECTOR: 'manual-responsables.pdf',
};

const ROLE_ES: Record<Role, string> = { ADMIN: 'Administración', MANAGER: 'Responsable', EMPLOYEE: 'Empleado/a', INSPECTOR: 'Inspección (solo consulta)' };
const ROLE_EN: Record<Role, string> = { ADMIN: 'Admin', MANAGER: 'Manager', EMPLOYEE: 'Employee', INSPECTOR: 'Inspector (read only)' };

export const manualPath = (role: Role): string => `/manuales/${FILE[role]}`;

/** Envía a una persona el manual de su perfil. Como todo correo, nunca lanza. */
export function sendManual(mail: MailService, to: { email: string; fullName: string; locale: string }, organization: string, role: Role): Promise<boolean> {
  const locale = to.locale === 'en' ? 'en' : 'es';
  return mail.send(
    to.email,
    manualEmail(locale, { name: to.fullName, organization, role: (locale === 'en' ? ROLE_EN : ROLE_ES)[role], url: mail.link(manualPath(role)) }),
    'manual',
  );
}
