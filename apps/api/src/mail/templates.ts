import { APP_NAME } from '@hr/shared';

type Locale = 'es' | 'en';

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Layout {
  locale: Locale;
  preheader: string;
  title: string;
  /** Párrafos en texto plano: se escapan al componer el HTML. */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Texto pequeño bajo el botón. */
  note?: string;
}

/**
 * Plantilla común: tablas y estilos en línea, que es lo que entienden todos los
 * clientes de correo (Outlook incluido). Siempre lleva versión en texto plano.
 */
function layout(l: Layout): { html: string; text: string } {
  const footer =
    l.locale === 'en'
      ? `This is an automatic message from ${APP_NAME}. If you weren't expecting it, you can ignore it.`
      : `Este es un mensaje automático de ${APP_NAME}. Si no lo esperabas, puedes ignorarlo.`;
  const copyHint = l.locale === 'en' ? 'If the button does not work, copy this link into your browser:' : 'Si el botón no funciona, copia este enlace en tu navegador:';

  const html = `<!doctype html>
<html lang="${l.locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(l.title)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f9;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f9">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px;font:700 18px/1.2 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1524">
<span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:#0067d6;vertical-align:middle;margin-right:8px"></span><span style="vertical-align:middle">${esc(APP_NAME)}</span>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e2e5ec;border-radius:16px;padding:32px 28px;font:400 16px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f1524">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;font-weight:700">${esc(l.title)}</h1>
${l.paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join('\n')}
${
  l.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td style="border-radius:12px;background:#0067d6">
<a href="${esc(l.button.url)}" style="display:inline-block;padding:14px 26px;font-weight:600;font-size:16px;color:#ffffff;text-decoration:none;border-radius:12px">${esc(l.button.label)}</a>
</td></tr></table>
${l.note ? `<p style="margin:12px 0 0;font-size:14px;color:#586174">${esc(l.note)}</p>` : ''}
<p style="margin:20px 0 0;font-size:13px;color:#586174">${esc(copyHint)}<br><a href="${esc(l.button.url)}" style="color:#4640d6;word-break:break-all">${esc(l.button.url)}</a></p>`
    : l.note
      ? `<p style="margin:12px 0 0;font-size:14px;color:#586174">${esc(l.note)}</p>`
      : ''
}
</td></tr>
<tr><td style="padding:20px 4px 0;font:400 12px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#636c7d">${esc(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [l.title, '', ...l.paragraphs.flatMap((p) => [p, '']), ...(l.button ? [`${l.button.label}: ${l.button.url}`, ''] : []), ...(l.note ? [l.note, ''] : []), '—', footer].join('\n');
  return { html, text };
}

const first = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

export function passwordResetEmail(locale: Locale, p: { name: string; url: string; minutes: number }): Rendered {
  if (locale === 'en') {
    return {
      subject: `Reset your ${APP_NAME} password`,
      ...layout({
        locale,
        preheader: `This link is valid for ${p.minutes} minutes.`,
        title: 'Reset your password',
        paragraphs: [`Hi ${first(p.name)},`, `We received a request to reset the password of your ${APP_NAME} account.`],
        button: { label: 'Choose a new password', url: p.url },
        note: `The link works once and expires in ${p.minutes} minutes. If you didn't ask for it, ignore this email: your password won't change.`,
      }),
    };
  }
  return {
    subject: `Restablece tu contraseña de ${APP_NAME}`,
    ...layout({
      locale,
      preheader: `El enlace es válido durante ${p.minutes} minutos.`,
      title: 'Restablece tu contraseña',
      paragraphs: [`Hola, ${first(p.name)}:`, `Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de ${APP_NAME}.`],
      button: { label: 'Elegir una contraseña nueva', url: p.url },
      note: `El enlace solo funciona una vez y caduca en ${p.minutes} minutos. Si no lo has pedido tú, ignora este correo: tu contraseña no cambiará.`,
    }),
  };
}

export function passwordChangedEmail(locale: Locale, p: { name: string; when: string; forgotUrl: string }): Rendered {
  if (locale === 'en') {
    return {
      subject: `Your ${APP_NAME} password was changed`,
      ...layout({
        locale,
        preheader: 'If it was you, there is nothing else to do.',
        title: 'Your password was changed',
        paragraphs: [`Hi ${first(p.name)},`, `The password of your ${APP_NAME} account was changed on ${p.when}. Other signed-in devices have been signed out.`, 'If it was you, there is nothing else to do.'],
        button: { label: "It wasn't me: reset my password", url: p.forgotUrl },
      }),
    };
  }
  return {
    subject: `Se ha cambiado tu contraseña de ${APP_NAME}`,
    ...layout({
      locale,
      preheader: 'Si has sido tú, no tienes que hacer nada más.',
      title: 'Se ha cambiado tu contraseña',
      paragraphs: [`Hola, ${first(p.name)}:`, `La contraseña de tu cuenta de ${APP_NAME} se cambió el ${p.when}. Se han cerrado las sesiones en otros dispositivos.`, 'Si has sido tú, no tienes que hacer nada más.'],
      button: { label: 'No he sido yo: restablecer la contraseña', url: p.forgotUrl },
    }),
  };
}

export function invitationEmail(locale: Locale, p: { organization: string; inviter: string; role: string; url: string; days: number }): Rendered {
  if (locale === 'en') {
    return {
      subject: `${p.inviter} invites you to ${p.organization} on ${APP_NAME}`,
      ...layout({
        locale,
        preheader: `Join as ${p.role}. The invitation expires in ${p.days} days.`,
        title: `Join ${p.organization}`,
        paragraphs: [
          `${p.inviter} has invited you to join ${p.organization} on ${APP_NAME} as ${p.role}.`,
          `With ${APP_NAME} you can clock in from your phone, check your schedule, submit expenses and receive your documents.`,
        ],
        button: { label: 'Accept the invitation', url: p.url },
        note: `Sign in or create your account with this email address. The invitation expires in ${p.days} days.`,
      }),
    };
  }
  return {
    subject: `${p.inviter} te invita a ${p.organization} en ${APP_NAME}`,
    ...layout({
      locale,
      preheader: `Únete como ${p.role}. La invitación caduca en ${p.days} días.`,
      title: `Únete a ${p.organization}`,
      paragraphs: [
        `${p.inviter} te ha invitado a unirte a ${p.organization} en ${APP_NAME} como ${p.role}.`,
        `Con ${APP_NAME} podrás fichar desde el móvil, consultar tu horario, enviar tus gastos y recibir tus documentos.`,
      ],
      button: { label: 'Aceptar la invitación', url: p.url },
      note: `Entra o crea tu cuenta con esta dirección de correo. La invitación caduca en ${p.days} días.`,
    }),
  };
}

/** Manual del perfil de la persona: al entrar en la empresa, al cambiar de perfil o cuando se lo reenvían. */
export function manualEmail(locale: Locale, p: { name: string; organization: string; role: string; url: string }): Rendered {
  if (locale === 'en') {
    return {
      subject: `Your ${APP_NAME} guide for ${p.organization}`,
      ...layout({
        locale,
        preheader: 'A step-by-step guide with screenshots for your profile.',
        title: 'Your user guide',
        paragraphs: [
          `Hi ${first(p.name)},`,
          `In ${p.organization} your profile is ${p.role}. This guide (PDF, in Spanish) explains step by step, with screenshots, everything you can do with it.`,
        ],
        button: { label: 'Open the guide', url: p.url },
        note: 'You can open it on your phone or print it.',
      }),
    };
  }
  return {
    subject: `Tu manual de ${APP_NAME} para ${p.organization}`,
    ...layout({
      locale,
      preheader: 'Una guía paso a paso, con capturas, para tu perfil.',
      title: 'Tu manual de uso',
      paragraphs: [`Hola, ${first(p.name)}:`, `En ${p.organization} tu perfil es ${p.role}. Este manual (PDF) explica paso a paso, con capturas, todo lo que puedes hacer con él.`],
      button: { label: 'Abrir el manual', url: p.url },
      note: 'Puedes abrirlo en el móvil o imprimirlo.',
    }),
  };
}

export function verifyEmail(locale: Locale, p: { name: string; url: string; hours: number }): Rendered {
  if (locale === 'en') {
    return {
      subject: `Confirm your ${APP_NAME} email`,
      ...layout({
        locale,
        preheader: 'One click and your account is ready.',
        title: 'Confirm your email',
        paragraphs: [`Hi ${first(p.name)},`, `Confirm that this address is yours to create companies and invite your team on ${APP_NAME}.`],
        button: { label: 'Confirm my email', url: p.url },
        note: `The link expires in ${p.hours} hours. If you didn't create an account, ignore this email.`,
      }),
    };
  }
  return {
    subject: `Confirma tu correo de ${APP_NAME}`,
    ...layout({
      locale,
      preheader: 'Un clic y tu cuenta queda lista.',
      title: 'Confirma tu correo',
      paragraphs: [`Hola, ${first(p.name)}:`, `Confirma que esta dirección es tuya para poder crear empresas e invitar a tu equipo en ${APP_NAME}.`],
      button: { label: 'Confirmar mi correo', url: p.url },
      note: `El enlace caduca en ${p.hours} horas. Si no has creado ninguna cuenta, ignora este correo.`,
    }),
  };
}

export function welcomeAdminEmail(locale: Locale, p: { name: string; organization: string; url: string; days: number }): Rendered {
  if (locale === 'en') {
    return {
      subject: `${p.organization} is ready on ${APP_NAME}`,
      ...layout({
        locale,
        preheader: 'Choose your password to get started.',
        title: `Welcome to ${APP_NAME}`,
        paragraphs: [`Hi ${first(p.name)},`, `The ${APP_NAME} space for ${p.organization} is ready and you are its administrator. Choose your password to sign in and invite your team.`],
        button: { label: 'Choose my password', url: p.url },
        note: `The link expires in ${p.days} days.`,
      }),
    };
  }
  return {
    subject: `${p.organization} ya está en ${APP_NAME}`,
    ...layout({
      locale,
      preheader: 'Elige tu contraseña para empezar.',
      title: `Bienvenida a ${APP_NAME}`,
      paragraphs: [`Hola, ${first(p.name)}:`, `El espacio de ${p.organization} en ${APP_NAME} está listo y eres su administrador/a. Elige tu contraseña para entrar e invitar a tu equipo.`],
      button: { label: 'Elegir mi contraseña', url: p.url },
      note: `El enlace caduca en ${p.days} días.`,
    }),
  };
}

/**
 * Aviso de la app que también llega por correo (según las preferencias de cada
 * persona). Uno solo, o varios juntos al terminar el horario de desconexión.
 */
export function noticeEmail(locale: Locale, p: { name: string; organization: string | null; lines: string[]; url: string; settingsUrl: string }): Rendered {
  const one = p.lines.length === 1;
  const en = locale === 'en';
  const where = p.organization ? (en ? ` · ${p.organization}` : ` · ${p.organization}`) : '';
  const subject = one ? `${p.lines[0]!.slice(0, 120)}${where}` : en ? `You have ${p.lines.length} new notices${where}` : `Tienes ${p.lines.length} avisos nuevos${where}`;
  return {
    subject,
    ...layout({
      locale,
      preheader: p.lines[0] ?? '',
      title: en ? 'New in HR-Core' : `Novedades en ${APP_NAME}`,
      paragraphs: [en ? `Hi ${first(p.name)},` : `Hola, ${first(p.name)}:`, ...p.lines],
      button: { label: en ? 'Open HR-Core' : `Abrir ${APP_NAME}`, url: p.url },
      note: en
        ? `You get these emails because you turned them on. Change it in Settings › Email notices: ${p.settingsUrl}`
        : `Recibes estos correos porque los tienes activados. Puedes cambiarlo en Ajustes › Avisos por correo: ${p.settingsUrl}`,
    }),
  };
}

/** Resumen diario para quien supervisa: lo que espera su decisión. */
export function digestEmail(locale: Locale, p: { name: string; organization: string; lines: string[]; url: string; settingsUrl: string }): Rendered {
  const en = locale === 'en';
  return {
    subject: en ? `Pending today at ${p.organization}` : `Pendiente hoy en ${p.organization}`,
    ...layout({
      locale,
      preheader: p.lines.join(' · '),
      title: en ? 'Your daily summary' : 'Tu resumen del día',
      paragraphs: [en ? `Hi ${first(p.name)}, this is what is waiting for you at ${p.organization}:` : `Hola, ${first(p.name)}. Esto es lo que te espera en ${p.organization}:`, ...p.lines.map((l) => `• ${l}`)],
      button: { label: en ? 'Review now' : 'Revisarlo ahora', url: p.url },
      note: en ? `Turn off the daily summary in Settings › Email notices: ${p.settingsUrl}` : `Puedes desactivar el resumen diario en Ajustes › Avisos por correo: ${p.settingsUrl}`,
    }),
  };
}
