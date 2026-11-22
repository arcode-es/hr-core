import type { DeployMode, LegalInfo } from '@hr/shared';

/*
 * Textos legales base. Son una plantilla razonable para España (RGPD, LOPDGDD, LSSI),
 * no asesoramiento jurídico: deben revisarse con la asesoría antes de tratar datos reales.
 * Los datos del responsable salen de la configuración del servidor (LEGAL_*).
 */

export type LegalPage = 'privacidad' | 'aviso-legal' | 'cookies';
export const LEGAL_PAGES: LegalPage[] = ['privacidad', 'aviso-legal', 'cookies'];

export interface LegalSection {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalText {
  title: string;
  intro: string;
  sections: LegalSection[];
}

interface Ctx {
  legal: LegalInfo | null;
  mode: DeployMode;
  app: string;
}

const MISSING_ES = '[pendiente de configurar]';
const MISSING_EN = '[not configured yet]';

function owner(c: Ctx, missing: string) {
  return {
    name: c.legal?.name || missing,
    taxId: c.legal?.taxId || missing,
    address: c.legal?.address || missing,
    email: c.legal?.email || missing,
    provider: c.legal?.provider || '',
  };
}

function es(page: LegalPage, c: Ctx): LegalText {
  const o = owner(c, MISSING_ES);
  const contact = `escribiendo a ${o.email}`;
  if (page === 'aviso-legal') {
    return {
      title: 'Aviso legal',
      intro: `Información sobre el titular de este sitio, conforme al artículo 10 de la Ley 34/2002 de servicios de la sociedad de la información (LSSI).`,
      sections: [
        { title: 'Titular', items: [`Titular: ${o.name}`, `NIF: ${o.taxId}`, `Domicilio: ${o.address}`, `Contacto: ${o.email}`] },
        {
          title: 'Objeto',
          paragraphs: [
            `${c.app} es una aplicación de control horario, cuadrantes, gastos y documentos laborales.${c.mode === 'demo' ? ' Esta instalación es una demostración con datos ficticios.' : ''}`,
          ],
        },
        {
          title: 'Condiciones de uso',
          paragraphs: [
            'Quien usa la aplicación se compromete a hacerlo de buena fe y conforme a la ley: a no introducir datos de terceros sin legitimación, a no intentar acceder a cuentas o datos ajenos y a no alterar el funcionamiento del servicio.',
            'Las credenciales son personales. Cada persona responde del uso que se haga con su cuenta.',
          ],
        },
        { title: 'Propiedad intelectual', paragraphs: [`El software, el diseño y los textos de ${c.app} pertenecen a su titular o a sus licenciantes. Los datos que introduce cada empresa y cada persona son suyos.`] },
        {
          title: 'Responsabilidad',
          paragraphs: [
            'El titular pone los medios razonables para que el servicio funcione de forma continua y segura, pero no puede garantizar la ausencia total de interrupciones o errores.',
            'Los registros de jornada y los documentos firmados en la aplicación tienen el valor que les dé la normativa aplicable; la firma es una firma electrónica simple con evidencias.',
          ],
        },
        { title: 'Ley aplicable', paragraphs: ['Estas condiciones se rigen por la legislación española.'] },
      ],
    };
  }
  if (page === 'cookies') {
    return {
      title: 'Política de cookies',
      intro: `${c.app} no usa cookies publicitarias ni de analítica, ni propias ni de terceros. Solo usa lo imprescindible para que la sesión y la aplicación funcionen, que no requiere consentimiento (artículo 22.2 de la LSSI).`,
      sections: [
        {
          title: 'Qué guardamos en tu navegador',
          items: [
            'Cookie de sesión (hr_rt): mantiene la sesión iniciada hasta 30 días. Es técnica, no la lee ningún tercero y solo se envía al servidor de la aplicación.',
            'Almacenamiento local: tus preferencias (tema, idioma, espacio activo) y la última sesión conocida, para abrir la aplicación sin cobertura.',
            'Cola sin conexión (IndexedDB): los fichajes y gastos que haces sin cobertura, hasta que se envían.',
            'Caché de la aplicación (service worker): los archivos de la aplicación, para que abra rápido y sin red.',
          ],
        },
        {
          title: 'Mapas',
          paragraphs: ['Los mapas se cargan desde los servidores de OpenStreetMap, que reciben la dirección IP del navegador al pedir las imágenes del mapa. No instalan cookies.'],
        },
        { title: 'Cómo borrarlo', paragraphs: ['Al cerrar la sesión se borran tus datos de la sesión. Puedes borrar todo lo demás desde los ajustes de privacidad de tu navegador.'] },
      ],
    };
  }
  return {
    title: 'Política de privacidad',
    intro:
      c.mode === 'demo'
        ? `Esta es una demostración de ${c.app} con datos ficticios. Entra con las cuentas de prueba y no introduzcas datos personales reales: cada noche se borra todo.`
        : `Cómo trata ${c.app} tus datos personales, para qué y con qué derechos, conforme al Reglamento General de Protección de Datos (RGPD) y a la Ley Orgánica 3/2018 (LOPDGDD).`,
    sections: [
      {
        title: 'Responsable',
        paragraphs: [
          `${o.name} (NIF ${o.taxId}), ${o.address}. Contacto: ${o.email}.`,
          `Cuando una empresa usa ${c.app} para gestionar a su plantilla, esa empresa es la responsable de los datos de sus trabajadores${o.provider ? ` y ${o.provider} presta el servicio como encargado del tratamiento` : ''}. Para ejercer tus derechos sobre esos datos, dirígete a tu empresa.`,
        ],
      },
      {
        title: 'Qué datos tratamos',
        items: [
          'Identificación y contacto: nombre, correo, teléfono y DNI/NIE.',
          'Registro de jornada: horas de entrada, salida, pausas y desplazamientos, con la hora del servidor y la del dispositivo.',
          'Ubicación: la posición GPS solo en el momento de fichar. Nunca se sigue la ubicación de forma continua.',
          'Fotos al fichar, si la empresa las pide, y fotos de tickets de gastos.',
          'Documentos laborales que recibes y, si los firmas, la rúbrica con sus evidencias técnicas (fecha, IP, navegador y huella SHA-256 del documento).',
          'Datos técnicos de seguridad: sesiones abiertas, dispositivo e IP de acceso.',
        ],
      },
      {
        title: 'Para qué y con qué base',
        items: [
          'Registro diario de jornada: obligación legal de la empresa (art. 34.9 del Estatuto de los Trabajadores; art. 6.1.c RGPD).',
          'Cuadrantes, gastos y documentos: ejecución de la relación laboral (art. 6.1.b RGPD).',
          'Geolocalización al fichar: control de la jornada con información previa y expresa a la plantilla (art. 90 LOPDGDD).',
          'Seguridad de las cuentas y del servicio: interés legítimo (art. 6.1.f RGPD).',
          'Notificaciones push: solo si las activas en tu dispositivo, y respetando el horario de desconexión de tu empresa (art. 88 LOPDGDD).',
        ],
      },
      {
        title: 'Cuánto tiempo',
        items: [
          'Registro de jornada: cuatro años (art. 34.9 del Estatuto de los Trabajadores). No se puede borrar antes, ni a petición.',
          'Fotos de fichaje: el plazo que fije tu empresa (por defecto, 12 meses). Después se borran y el fichaje se conserva sin ellas.',
          'Gastos y documentos: mientras dure la relación laboral y, después, los plazos de prescripción legales.',
          'Cuenta: hasta que se cierra. Los datos que la ley obliga a conservar se guardan bloqueados.',
        ],
      },
      {
        title: 'Con quién se comparten',
        paragraphs: [
          `No se venden ni se ceden para publicidad. Los tratan, por cuenta del responsable, el proveedor de alojamiento del servidor y el de envío de correo electrónico. Las direcciones postales de los fichajes se obtienen enviando las coordenadas a un servicio de geocodificación (por defecto, OpenStreetMap Nominatim).`,
          'Si algún proveedor estuviera fuera del Espacio Económico Europeo, la transferencia se ampararía en las garantías del RGPD (decisión de adecuación o cláusulas contractuales tipo).',
          'Inspección de Trabajo y la representación legal de la plantilla pueden acceder al registro de jornada cuando la ley lo prevé.',
        ],
      },
      {
        title: 'Tus derechos',
        paragraphs: [
          `Puedes pedir acceso, rectificación, supresión, oposición, limitación y portabilidad ${contact}. Desde Ajustes puedes descargar todos tus datos en un archivo.`,
          'Si crees que no se han respetado tus derechos, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).',
        ],
      },
    ],
  };
}

function en(page: LegalPage, c: Ctx): LegalText {
  const o = owner(c, MISSING_EN);
  if (page === 'aviso-legal') {
    return {
      title: 'Legal notice',
      intro: 'Information about the owner of this site, as required by Spanish Law 34/2002 on information society services (LSSI).',
      sections: [
        { title: 'Owner', items: [`Owner: ${o.name}`, `Tax ID: ${o.taxId}`, `Address: ${o.address}`, `Contact: ${o.email}`] },
        { title: 'Purpose', paragraphs: [`${c.app} is an app for time tracking, schedules, expenses and employment documents.${c.mode === 'demo' ? ' This installation is a demo with fictitious data.' : ''}`] },
        { title: 'Terms of use', paragraphs: ['Use the app in good faith and lawfully: do not enter third-party data without a legal basis, do not try to access other accounts and do not disrupt the service. Credentials are personal.'] },
        { title: 'Intellectual property', paragraphs: [`The software, design and texts of ${c.app} belong to its owner or licensors. The data each company and person enters is theirs.`] },
        { title: 'Liability', paragraphs: ['The owner takes reasonable measures for the service to run continuously and securely, but cannot guarantee it will be free of interruptions or errors. Signatures are simple electronic signatures with evidence.'] },
        { title: 'Governing law', paragraphs: ['These terms are governed by Spanish law.'] },
      ],
    };
  }
  if (page === 'cookies') {
    return {
      title: 'Cookie policy',
      intro: `${c.app} uses no advertising or analytics cookies, first or third party. It only uses what is strictly necessary for the session and the app to work, which needs no consent (art. 22.2 LSSI).`,
      sections: [
        {
          title: 'What we store in your browser',
          items: [
            'Session cookie (hr_rt): keeps you signed in for up to 30 days. Technical, never read by third parties, only sent to the app server.',
            'Local storage: your preferences (theme, language, active workspace) and the last known session, to open the app offline.',
            'Offline queue (IndexedDB): clock events and expenses made without coverage, until they are sent.',
            'App cache (service worker): the app files, so it opens fast and offline.',
          ],
        },
        { title: 'Maps', paragraphs: ['Maps are loaded from OpenStreetMap servers, which receive the browser IP address when serving map images. They set no cookies.'] },
        { title: 'How to delete it', paragraphs: ['Signing out deletes your session data. You can delete everything else from your browser privacy settings.'] },
      ],
    };
  }
  return {
    title: 'Privacy policy',
    intro:
      c.mode === 'demo'
        ? `This is a ${c.app} demo with fictitious data. Use the test accounts and do not enter real personal data: everything is wiped every night.`
        : `How ${c.app} processes your personal data, why and with which rights, under the GDPR and Spanish Organic Law 3/2018 (LOPDGDD).`,
    sections: [
      {
        title: 'Controller',
        paragraphs: [
          `${o.name} (tax ID ${o.taxId}), ${o.address}. Contact: ${o.email}.`,
          `When a company uses ${c.app} to manage its staff, that company is the controller of its employees' data${o.provider ? ` and ${o.provider} provides the service as processor` : ''}. To exercise your rights over that data, contact your company.`,
        ],
      },
      {
        title: 'What data we process',
        items: [
          'Identity and contact: name, email, phone and ID number.',
          'Working time record: start, end, breaks and travel, with server and device time.',
          'Location: GPS position only at the moment of clocking. Location is never tracked continuously.',
          'Clock-in photos, if the company requires them, and expense receipt photos.',
          'Employment documents you receive and, if you sign them, the signature with its technical evidence (date, IP, browser and SHA-256 fingerprint).',
          'Security data: open sessions, device and sign-in IP.',
        ],
      },
      {
        title: 'Why and on which legal basis',
        items: [
          'Daily working time record: legal obligation of the employer (art. 34.9 Spanish Workers Statute; art. 6.1.c GDPR).',
          'Schedules, expenses and documents: performance of the employment relationship (art. 6.1.b GDPR).',
          'Location when clocking: working time control with prior, express information to staff (art. 90 LOPDGDD).',
          'Account and service security: legitimate interest (art. 6.1.f GDPR).',
          "Push notifications: only if you enable them, respecting your company's disconnection hours (art. 88 LOPDGDD).",
        ],
      },
      {
        title: 'How long',
        items: [
          'Working time record: four years (art. 34.9 Workers Statute). It cannot be deleted earlier, even on request.',
          'Clock-in photos: the period your company sets (12 months by default). Then they are deleted and the record is kept without them.',
          'Expenses and documents: during the employment relationship and then the legal limitation periods.',
          'Account: until it is closed. Data the law requires to keep is kept blocked.',
        ],
      },
      {
        title: 'Who we share it with',
        paragraphs: [
          'Data is never sold or shared for advertising. It is processed, on behalf of the controller, by the server hosting provider and the email delivery provider. Postal addresses of clock events are obtained by sending coordinates to a geocoding service (OpenStreetMap Nominatim by default).',
          'Any transfer outside the EEA would rely on GDPR safeguards (adequacy decision or standard contractual clauses).',
          'Labour inspection and worker representatives may access the time record where the law provides.',
        ],
      },
      {
        title: 'Your rights',
        paragraphs: [
          `You can request access, rectification, erasure, objection, restriction and portability by writing to ${o.email}. In Settings you can download all your data in one file.`,
          'You can lodge a complaint with the Spanish Data Protection Agency (www.aepd.es).',
        ],
      },
    ],
  };
}

export const legalText = (locale: string, page: LegalPage, ctx: Ctx): LegalText => (locale === 'en' ? en(page, ctx) : es(page, ctx));
