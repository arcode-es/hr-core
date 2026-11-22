import type { PayrollColumn } from './schemas';
/**
 * Enumerados del dominio. Deben coincidir con los `enum` de apps/api/prisma/schema.prisma.
 * Se declaran como objetos `as const` para poder usarlos como valor y como tipo en API y web.
 */
const values = <T extends string>(...v: T[]) =>
  Object.freeze(Object.fromEntries(v.map((x) => [x, x]))) as { readonly [K in T]: K };

export const MembershipRole = values('ADMIN', 'MANAGER', 'EMPLOYEE', 'INSPECTOR');
export type MembershipRole = keyof typeof MembershipRole;

export const EntryType = values('WORK', 'BREAK', 'TRAVEL');
export type EntryType = keyof typeof EntryType;

export const BreakKind = values('MEAL', 'REST', 'OTHER');
export type BreakKind = keyof typeof BreakKind;

export const EntryOrigin = values('REALTIME', 'MANUAL');
export type EntryOrigin = keyof typeof EntryOrigin;

export const ApprovalStatus = values('APPROVED', 'PENDING', 'REJECTED');
export type ApprovalStatus = keyof typeof ApprovalStatus;

export const ExpenseCategory = values('MEAL', 'FUEL', 'TOLL', 'LODGING', 'MATERIAL', 'MILEAGE', 'OTHER');
export type ExpenseCategory = keyof typeof ExpenseCategory;

export const ExpenseStatus = values('PENDING', 'APPROVED', 'REJECTED', 'REIMBURSED');
export type ExpenseStatus = keyof typeof ExpenseStatus;

export const PaymentMethod = values('COMPANY_CARD', 'EMPLOYEE_PAID');
export type PaymentMethod = keyof typeof PaymentMethod;

export const DocumentCategory = values(
  'PAYROLL',
  'CONTRACT',
  'SAFETY',
  'CERTIFICATE',
  'ANNOUNCEMENT',
  'MEDICAL_LEAVE',
  'TIMESHEET',
  'OTHER',
);
export type DocumentCategory = keyof typeof DocumentCategory;

export const DocumentStatus = values('SENT', 'VIEWED', 'SIGNED');
export type DocumentStatus = keyof typeof DocumentStatus;

export const NotificationType = values(
  'SHIFT_PUBLISHED',
  'SHIFT_UPDATED',
  'TIME_ENTRY_PENDING',
  'TIME_ENTRY_REVIEWED',
  'EXPENSE_PENDING',
  'EXPENSE_REVIEWED',
  'DOCUMENT_RECEIVED',
  'DOCUMENT_SIGNED',
  'INVITATION',
  'ABSENCE_PENDING',
  'ABSENCE_REVIEWED',
  'ALERT',
  'DOCUMENT_REMINDER',
);
export type NotificationType = keyof typeof NotificationType;

/** Nombre del producto en la interfaz, los correos y los informes. */
export const APP_NAME = 'HR-Core';

export const SUPPORTED_LOCALES = ['es', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

/** Espacio de trabajo activo: el personal del usuario o una organización. */
export type Workspace =
  | { kind: 'personal' }
  | { kind: 'organization'; organizationId: string; role: MembershipRole };

/** Ajustes por organización (`organizations.settings`). */
export interface OrganizationSettings {
  timezone: string;
  /** Minutos de cortesía antes de marcar un retraso. */
  lateToleranceMinutes: number;
  /** Tramo nocturno en hora local, formato HH:mm. */
  nightStart: string;
  nightEnd: string;
  requirePhotoOnClock: boolean;
  allowEmployeeManualEntries: boolean;
  defaultGeofenceRadiusMeters: number;
  currency: string;
  /** Importe por kilómetro al usar vehículo propio. */
  mileageRatePerKm: number;
  /** Meses que se guardan las fotos de fichaje; 0 = sin límite. El registro de jornada no se toca. */
  photoRetentionMonths: number;
  /** Desconexión digital: fuera de este horario (hora local) no se envían notificaciones push. */
  quietHours: QuietHours;
  /** Texto de la empresa que se añade al aviso de geolocalización (art. 90 LOPDGDD). */
  geoNoticeText: string;
  /** Comunidad autónoma (ISO 3166-2, p. ej. ES-VC) para importar sus festivos; vacía = solo nacionales. */
  region: string;
  /** Días de vacaciones al año por persona (se puede cambiar persona a persona). */
  vacationDays: number;
  /** Cómo se cuentan: días laborables (sin fines de semana ni festivos) o naturales. */
  vacationUnit: 'WORKING' | 'NATURAL';
  /** Avisos de jornada: entrada sin fichar, jornada larga, poco descanso, horas extra del año. */
  alertsEnabled: boolean;
  /** Minutos tras el inicio del turno sin fichar para avisar. */
  missedClockInMinutes: number;
  /** Horas de jornada abierta a partir de las que se avisa (olvido de fichar la salida). */
  maxOpenHours: number;
  /** Tope anual de horas extraordinarias (80 h en el art. 35.2 ET). */
  overtimeYearLimit: number;
  /** Envío automático del registro de jornada del mes anterior a cada persona (art. 35.5 ET). */
  monthlyTimesheet: MonthlyTimesheet;
  /** Columnas (y su orden) del archivo para la gestoría. */
  payrollColumns: PayrollColumn[];
  /** Recargo de las horas extra sobre el coste por hora, en %, para el coste por obra. */
  overtimeSurchargePct: number;
  /** Marca del cliente: nombre comercial y color de acento (#rrggbb); vacíos = los de HR-Core. */
  brandName: string;
  accentColor: string;
  /** Clave del logotipo en el almacén (interno: el cliente solo ve si hay logotipo). */
  logoKey: string;
}


export const DEFAULT_PAYROLL_COLUMNS: PayrollColumn[] = [
  'dni',
  'name',
  'department',
  'workedDays',
  'ordinaryHours',
  'overtimeHours',
  'nightHours',
  'travelHours',
  'vacationDays',
  'sickDays',
  'otherAbsenceDays',
  'expenses',
  'mileageKm',
  'mileageAmount',
];

export type MonthlyTimesheet = {
  enabled: boolean;
  /** Día del mes (1–28) en que se envía el registro del mes anterior. */
  day: number;
  /** Se pide firmarlo, o basta con confirmar la lectura. */
  requireSignature: boolean;
};

// `type` y no `interface`: así se puede guardar tal cual en una columna JSON.
export type QuietHours = {
  enabled: boolean;
  /** HH:mm: desde cuándo no se avisa... */
  start: string;
  /** ...y hasta cuándo (puede ser del día siguiente). */
  end: string;
  /** Sin avisos en todo el sábado y el domingo. */
  weekends: boolean;
};

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  timezone: 'Europe/Madrid',
  lateToleranceMinutes: 5,
  nightStart: '22:00',
  nightEnd: '06:00',
  requirePhotoOnClock: false,
  allowEmployeeManualEntries: true,
  defaultGeofenceRadiusMeters: 200,
  currency: 'EUR',
  mileageRatePerKm: 0.26,
  photoRetentionMonths: 12,
  quietHours: { enabled: false, start: '20:00', end: '08:00', weekends: true },
  geoNoticeText: '',
  region: '',
  vacationDays: 22,
  vacationUnit: 'WORKING',
  alertsEnabled: true,
  missedClockInMinutes: 30,
  maxOpenHours: 10,
  overtimeYearLimit: 80,
  monthlyTimesheet: { enabled: false, day: 3, requireSignature: true },
  payrollColumns: DEFAULT_PAYROLL_COLUMNS,
  overtimeSurchargePct: 0,
  brandName: '',
  accentColor: '',
  logoKey: '',
};

/** Comunidades y ciudades autónomas (ISO 3166-2), para los festivos autonómicos. */
export const SPANISH_REGIONS = [
  ['ES-AN', 'Andalucía'],
  ['ES-AR', 'Aragón'],
  ['ES-AS', 'Asturias'],
  ['ES-IB', 'Illes Balears'],
  ['ES-CN', 'Canarias'],
  ['ES-CB', 'Cantabria'],
  ['ES-CL', 'Castilla y León'],
  ['ES-CM', 'Castilla-La Mancha'],
  ['ES-CT', 'Cataluña'],
  ['ES-EX', 'Extremadura'],
  ['ES-GA', 'Galicia'],
  ['ES-MD', 'Comunidad de Madrid'],
  ['ES-MC', 'Región de Murcia'],
  ['ES-NC', 'Navarra'],
  ['ES-PV', 'País Vasco'],
  ['ES-RI', 'La Rioja'],
  ['ES-VC', 'Comunitat Valenciana'],
  ['ES-CE', 'Ceuta'],
  ['ES-ML', 'Melilla'],
] as const;

const DAY_MS = 86_400_000;
const utc = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Fechas (AAAA-MM-DD) de un intervalo cerrado [start, end]. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = utc(start); t <= utc(end); t += DAY_MS) out.push(iso(t));
  return out;
}

/** ¿Es sábado o domingo? */
export const isWeekend = (date: string): boolean => {
  const d = new Date(utc(date)).getUTCDay();
  return d === 0 || d === 6;
};

/**
 * Días que consume una ausencia: laborables (sin fines de semana ni festivos) o
 * naturales. Medio día cuenta 0,5. La misma cuenta en la API y en la web.
 */
export function absenceDays(start: string, end: string, unit: 'WORKING' | 'NATURAL', holidays: ReadonlySet<string>, halfDay = false): number {
  const days = datesBetween(start, end).filter((d) => unit === 'NATURAL' || (!isWeekend(d) && !holidays.has(d))).length;
  return halfDay && start === end ? Math.min(days, 0.5) : days;
}

/** Ajustes guardados en la empresa, completados con los valores por defecto (también los anidados). */
export function resolveSettings(raw: unknown): OrganizationSettings {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<OrganizationSettings>;
  return {
    ...DEFAULT_ORGANIZATION_SETTINGS,
    ...saved,
    quietHours: { ...DEFAULT_ORGANIZATION_SETTINGS.quietHours, ...(saved.quietHours ?? {}) },
    monthlyTimesheet: { ...DEFAULT_ORGANIZATION_SETTINGS.monthlyTimesheet, ...(saved.monthlyTimesheet ?? {}) },
  };
}

/**
 * Qué avisos llegan también por correo, por grupos. El aviso dentro de la app (y el
 * push) llega siempre; el correo es para quien no abre la app a diario.
 */
export type EmailPrefs = {
  /** Documentos recibidos, recordatorios de firma y firmas de otros. */
  documents: boolean;
  /** Respuestas a lo que he pedido: jornadas, gastos y ausencias aprobadas o rechazadas. */
  requests: boolean;
  /** Cada cosa que llega para validar (para quien supervisa). */
  pending: boolean;
  /** Turnos publicados y cambios de horario. */
  schedule: boolean;
  /** Alertas de jornada. */
  alerts: boolean;
  /** Resumen diario de lo pendiente (para quien supervisa). */
  digest: boolean;
};

export const DEFAULT_EMAIL_PREFS: EmailPrefs = { documents: true, requests: true, pending: false, schedule: true, alerts: true, digest: true };

export function resolveEmailPrefs(raw: unknown): EmailPrefs {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<EmailPrefs>;
  return { ...DEFAULT_EMAIL_PREFS, ...saved };
}

/** Grupo de preferencias de correo de cada tipo de aviso (null = nunca por correo). */
export const EMAIL_GROUP: Record<NotificationType, Exclude<keyof EmailPrefs, 'digest'> | null> = {
  SHIFT_PUBLISHED: 'schedule',
  SHIFT_UPDATED: 'schedule',
  TIME_ENTRY_PENDING: 'pending',
  TIME_ENTRY_REVIEWED: 'requests',
  EXPENSE_PENDING: 'pending',
  EXPENSE_REVIEWED: 'requests',
  DOCUMENT_RECEIVED: 'documents',
  DOCUMENT_SIGNED: 'documents',
  DOCUMENT_REMINDER: 'documents',
  INVITATION: null,
  ABSENCE_PENDING: 'pending',
  ABSENCE_REVIEWED: 'requests',
  ALERT: 'alerts',
};

export interface HealthStatus {
  status: 'ok' | 'degraded';
  version: string;
  serverTime: string;
  database: { up: boolean; postgis: string | null };
}

export * from './schemas';
