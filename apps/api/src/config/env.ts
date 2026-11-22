import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  /**
   * demo: la demo pública (sin registro, sin correo, acceso de un clic, se restablece cada noche).
   * client: el servidor de un cliente (una sola empresa; solo entra quien tiene invitación).
   * open: registro libre con verificación del correo.
   */
  DEPLOY_MODE: z.enum(['demo', 'client', 'open']).default('open'),
  /** Ruta donde se publica la app (p. ej. /HR-core), sin barra final. Vacía = raíz del dominio. */
  BASE_PATH: z
    .string()
    .default('')
    .transform((v) => v.replace(/\/+$/, ''))
    .refine((v) => v === '' || /^(\/[A-Za-z0-9._-]+)+$/.test(v), 'debe empezar por / y no llevar espacios'),
  /** En modo open: required exige confirmar el correo antes de crear empresas o invitar. */
  EMAIL_VERIFICATION: z.enum(['required', 'off']).default('required'),
  /** Contraseña de las cuentas de la demo (se publica en la web). */
  DEMO_PASSWORD: z.string().min(8).default('Demo-HRCore-2026'),
  /** Tareas programadas (avisos, recordatorios, restablecer la demo). */
  JOBS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  JOBS_TIMEZONE: z.string().default('Europe/Madrid'),
  /** Intentos fallidos seguidos antes de bloquear la cuenta, y minutos de bloqueo. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  /** Invitaciones enviadas por empresa en 24 h (alta masiva incluida): frena el envío masivo de correo. */
  INVITES_PER_DAY: z.coerce.number().int().positive().default(200),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  /** Peticiones por minuto y por IP. El de /auth es mucho más estricto: frena la fuerza bruta. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  /** s3: MinIO, AWS S3 o R2. local: disco del servidor, para instalaciones sencillas y pruebas. */
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  /** URL pública de la API, para firmar los enlaces a archivos con el driver local. */
  API_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_BUCKET: z.string().default('hr-gestion'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
  GEOCODER_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  GEOCODER_USER_AGENT: z.string().min(3).default('hr-gestion/0.1'),
  /** URL pública de la web (con su ruta base), para los enlaces de los correos. */
  APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  /** smtp: cualquier servidor de correo. resend: la API de Resend. log: solo se registran en el log (desarrollo y tests). */
  EMAIL_DRIVER: z.enum(['smtp', 'resend', 'log']).default('log'),
  RESEND_API_KEY: z.string().default(''),
  SMTP_HOST: z.string().default(''),
  /** 587 con STARTTLS (lo habitual) o 465 con TLS directo. */
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** Vacío: se deduce del puerto (465 → TLS directo; si no, STARTTLS obligatorio). */
  SMTP_SECURE: z
    .enum(['true', 'false', ''])
    .default('')
    .transform((v) => (v === '' ? undefined : v === 'true')),
  /** Exigir STARTTLS cuando no hay TLS directo. false solo para un relé en la misma máquina o red privada. */
  SMTP_REQUIRE_TLS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  EMAIL_FROM: z.string().min(3).default('HR-Core <no-reply@example.com>'),
  EMAIL_REPLY_TO: z.string().default(''),
  /** Solo con EMAIL_DRIVER=log: carpeta donde dejar cada correo como JSON (tests de navegador). */
  EMAIL_LOG_DIR: z.string().default(''),
  OCR_PROVIDER: z.enum(['mock']).default('mock'),
  /** Responsable del sitio, para el aviso legal y la política de privacidad. Sin nombre, las páginas lo piden. */
  LEGAL_NAME: z.string().default(''),
  LEGAL_TAX_ID: z.string().default(''),
  LEGAL_ADDRESS: z.string().default(''),
  LEGAL_EMAIL: z.string().default(''),
  /** Proveedor tecnológico (encargado del tratamiento), si no es el propio responsable. */
  LEGAL_PROVIDER: z.string().default(''),
  /** Subencargados de esta instalación, separados por «;» (p. ej. «Hetzner Online GmbH (alojamiento; Alemania)»). */
  LEGAL_SUBPROCESSORS: z
    .string()
    .default('')
    .transform((v) => v.split(';').map((s) => s.trim()).filter(Boolean)),
});

export type Env = z.infer<typeof schema>;

/** Valida el entorno al arrancar: la API no levanta con configuración incompleta. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Variables de entorno no válidas:\n${issues.join('\n')}`);
  }
  return parsed.data;
}
