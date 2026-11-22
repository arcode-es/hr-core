import { z } from 'zod';

/** Contratos de la API: validan en el servidor y en los formularios del cliente. */

/** Columnas posibles del archivo para la gestoría, una fila por persona y mes. */
export const PAYROLL_COLUMNS = [
  'dni',
  'name',
  'department',
  'jobTitle',
  'workedDays',
  'workedHours',
  'ordinaryHours',
  'overtimeHours',
  'nightHours',
  'travelHours',
  'plannedHours',
  'vacationDays',
  'sickDays',
  'otherAbsenceDays',
  'lateCount',
  'expenses',
  'mileageKm',
  'mileageAmount',
] as const;
export type PayrollColumn = (typeof PAYROLL_COLUMNS)[number];


const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(128);
const fullName = z.string().trim().min(2).max(120);
const locale = z.enum(['es', 'en']);
const role = z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'INSPECTOR']);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Tokens de enlaces de un solo uso (invitación, recuperación, verificación). */
const linkToken = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/);

/**
 * `inviteToken`: quien se registra desde una invitación la trae. En los servidores
 * de clientes es obligatoria, y en cualquier modo demuestra que el correo es suyo.
 */
export const registerSchema = z.object({ email, password, fullName, locale: locale.optional(), inviteToken: linkToken.optional() });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  fullName: fullName.optional(),
  dniNie: optionalText(20),
  phone: optionalText(30),
  locale: locale.optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  taxId: optionalText(20),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

const dniNie = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s.-]/g, ''))
  .pipe(z.string().regex(/^([0-9]{8}[A-Z]|[XYZ][0-9]{7}[A-Z])$/));

/** Datos que se pueden dejar preparados en la invitación (alta masiva): se aplican al aceptarla. */
const invitationPrefill = {
  fullName: fullName.optional(),
  dniNie: dniNie.optional(),
  jobTitle: optionalText(80),
  departmentId: z.string().uuid().nullable().optional(),
  weeklyHours: z.number().min(0).max(60).nullable().optional(),
};

export const createInvitationSchema = z.object({ email, role: role.default('EMPLOYEE'), ...invitationPrefill });
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** Fila de la plantilla de alta masiva, ya leída y comprobada. */
export interface ImportRow {
  /** Número de fila en el archivo (la cabecera es la 1). */
  line: number;
  email: string;
  fullName: string;
  dniNie: string | null;
  role: Role;
  department: string | null;
  jobTitle: string | null;
  weeklyHours: number | null;
  /** Claves de error (vacío = se puede importar). */
  errors: ImportError[];
}

export const IMPORT_ERRORS = ['EMAIL', 'NAME', 'DNI', 'ROLE', 'HOURS', 'DUPLICATE', 'MEMBER'] as const;
export type ImportError = (typeof IMPORT_ERRORS)[number];

export interface ImportPreview {
  rows: ImportRow[];
  /** Columnas reconocidas en la cabecera. */
  columns: string[];
}

export const importInvitationsSchema = z.object({
  rows: z
    .array(
      z.object({
        email,
        fullName,
        dniNie: dniNie.nullable(),
        role,
        department: z.string().trim().min(1).max(80).nullable(),
        jobTitle: z.string().trim().min(1).max(80).nullable(),
        weeklyHours: z.number().min(0).max(60).nullable(),
      }),
    )
    .min(1)
    .max(500),
});
export type ImportInvitationsInput = z.infer<typeof importInvitationsSchema>;

export interface ImportResult {
  invited: number;
  /** Correos que no se han podido enviar (la invitación existe; el enlace se puede reenviar). */
  notEmailed: number;
  departmentsCreated: number;
}

// ── Departamentos ────────────────────────────────────────────────────────

export const departmentSchema = z.object({ name: z.string().trim().min(2).max(80) });
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const departmentManagersSchema = z.object({ membershipIds: z.array(z.string().uuid()).max(50) });

export interface DepartmentDto {
  id: string;
  name: string;
  members: number;
  /** Responsables que ven a su gente (y solo a ella). */
  managers: { membershipId: string; fullName: string }[];
}

export const updateMemberSchema = z
  .object({
    role: role.optional(),
    active: z.boolean().optional(),
    jobTitle: optionalText(80),
    /** Días de vacaciones de esta persona; null = los de la empresa. */
    vacationDays: z.number().int().min(0).max(60).nullable().optional(),
    /** Jornada anual pactada en horas (convenio); null = sin indicar. */
    annualHours: z.number().min(0).max(3000).nullable().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    weeklyHours: z.number().min(0).max(60).nullable().optional(),
    /** Coste por hora para el coste por obra; null = sin indicar. */
    hourlyCost: z.number().min(0).max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

// ── Respuestas ───────────────────────────────────────────────────────────

export type Role = z.infer<typeof role>;

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  dniNie: string | null;
  phone: string | null;
  locale: 'es' | 'en';
  timezone: string;
  isSuperadmin: boolean;
  /** Ha confirmado su correo (o entró con una invitación). */
  emailVerified: boolean;
}

export type WorkspaceSummary =
  | { kind: 'personal' }
  | {
      kind: 'organization';
      organizationId: string;
      name: string;
      role: Role;
      /** Ya ha recibido el aviso de geolocalización de esta empresa (solo en GET /me). */
      geoNoticeAccepted?: boolean;
      /** Marca del cliente (solo en GET /me): nombre comercial, color y si tiene logotipo. */
      branding?: Branding;
    };

export interface Branding {
  name: string | null;
  accent: string | null;
  logo: boolean;
}

export interface MeResponse {
  user: UserProfile;
  workspaces: WorkspaceSummary[];
}

export interface AuthResponse {
  accessToken: string;
  /** Segundos hasta que caduca el token de acceso. */
  expiresIn: number;
}

export interface MemberDto {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  jobTitle: string | null;
  active: boolean;
  joinedAt: string;
  vacationDays: number | null;
  annualHours: number | null;
  weeklyHours: number | null;
  department: { id: string; name: string } | null;
  /** Solo para la administración; null para el resto. */
  hourlyCost: number | null;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  fullName: string | null;
  department: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED';
  /** Veces que se ha enviado el correo (el primero y los reenvíos). */
  sendCount: number;
  lastSentAt: string;
  expiresAt: string;
  createdAt: string;
  /** Solo se devuelve al crearla: el enlace no se puede recuperar después. */
  token?: string;
  /** true si se ha enviado por correo al invitado. */
  emailed?: boolean;
}

export interface InvitationPreview {
  organizationName: string;
  email: string;
  /** Nombre que dejó preparado la empresa, para rellenar el registro. */
  fullName: string | null;
  role: Role;
  invitedBy: string;
  status: 'valid' | 'expired' | 'accepted';
}

/** Códigos de error estables que el cliente traduce. */
export const ErrorCode = {
  VALIDATION: 'VALIDATION',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN_WORKSPACE: 'FORBIDDEN_WORKSPACE',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  INVITATION_INVALID: 'INVITATION_INVALID',
  RESET_INVALID: 'RESET_INVALID',
  INVITATION_EMAIL_MISMATCH: 'INVITATION_EMAIL_MISMATCH',
  LAST_ADMIN: 'LAST_ADMIN',
  INVALID_CLOCK_STATE: 'INVALID_CLOCK_STATE',
  INVALID_PHOTO: 'INVALID_PHOTO',
  INVALID_RANGE: 'INVALID_RANGE',
  OVERLAP: 'OVERLAP',
  CORRECTION_PENDING: 'CORRECTION_PENDING',
  MANUAL_NOT_ALLOWED: 'MANUAL_NOT_ALLOWED',
  WORKDAY_OPEN: 'WORKDAY_OPEN',
  EXPENSE_LOCKED: 'EXPENSE_LOCKED',
  INVALID_DOCUMENT: 'INVALID_DOCUMENT',
  DNI_REQUIRED: 'DNI_REQUIRED',
  ALREADY_SIGNED: 'ALREADY_SIGNED',
  OFFLINE_EVENT_REJECTED: 'OFFLINE_EVENT_REJECTED',
  RATE_LIMITED: 'RATE_LIMITED',
  REGISTRATION_CLOSED: 'REGISTRATION_CLOSED',
  INVITATION_REQUIRED: 'INVITATION_REQUIRED',
  ORG_CREATION_DISABLED: 'ORG_CREATION_DISABLED',
  DEMO_READ_ONLY: 'DEMO_READ_ONLY',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  VERIFY_INVALID: 'VERIFY_INVALID',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DELETE_DISABLED: 'ACCOUNT_DELETE_DISABLED',
  HOLIDAYS_UNAVAILABLE: 'HOLIDAYS_UNAVAILABLE',
  ABSENCE_LOCKED: 'ABSENCE_LOCKED',
  PHOTO_REQUIRED: 'PHOTO_REQUIRED',
  QR_INVALID: 'QR_INVALID',
  KIOSK_INVALID: 'KIOSK_INVALID',
  PIN_INVALID: 'PIN_INVALID',
  PIN_LOCKED: 'PIN_LOCKED',
  PIN_NOT_SET: 'PIN_NOT_SET',
  INVITE_LIMIT: 'INVITE_LIMIT',
  IMPORT_UNREADABLE: 'IMPORT_UNREADABLE',
  PAYROLL_UNREADABLE: 'PAYROLL_UNREADABLE',
  DEPARTMENT_EXISTS: 'DEPARTMENT_EXISTS',
  PATTERN_EXISTS: 'PATTERN_EXISTS',
  LOGO_INVALID: 'LOGO_INVALID',
} as const;
export type ErrorCode = keyof typeof ErrorCode;

// ── Ubicaciones y geocercas ──────────────────────────────────────────────

export const GEOFENCE_MIN_METERS = 25;
export const GEOFENCE_MAX_METERS = 2000;
export const LOCATION_COLORS = ['#4f46e5', '#0c8f63', '#d97706', '#dc2626', '#0891b2', '#9333ea'] as const;

const coordinates = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
};

export const locationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  address: optionalText(240),
  ...coordinates,
  geofenceRadiusMeters: z.number().int().min(GEOFENCE_MIN_METERS).max(GEOFENCE_MAX_METERS),
  color: z.enum(LOCATION_COLORS).optional(),
});
export type LocationInput = z.infer<typeof locationSchema>;

export const updateLocationSchema = locationSchema.partial().extend({ isActive: z.boolean().optional() });
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

/** Punto GPS del dispositivo; llega como texto en la query. */
export const positionQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(100000).optional(),
});
export type PositionQuery = z.infer<typeof positionQuerySchema>;

export const geoSearchQuerySchema = z.object({
  q: z.string().trim().min(3).max(200),
  lang: z.enum(['es', 'en']).default('es'),
});
export const geoReverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  lang: z.enum(['es', 'en']).default('es'),
});

export interface LocationDto {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  color: string;
  isActive: boolean;
  /** true si es una ubicación personal del usuario, no de la empresa. */
  personal: boolean;
}

/** Resultado de comparar una posición con una geocerca. */
export interface GeofenceMatch {
  location: LocationDto;
  /** Metros desde la posición hasta el centro. */
  distanceMeters: number;
  within: boolean;
  /** Metros que faltan para entrar en el perímetro (0 si está dentro). */
  outsideByMeters: number;
}

export interface GeoPlace {
  label: string;
  latitude: number;
  longitude: number;
}

// ── Fichaje ──────────────────────────────────────────────────────────────

export const ClockAction = { START: 'START', PAUSE: 'PAUSE', RESUME: 'RESUME', STOP: 'STOP' } as const;
export type ClockAction = keyof typeof ClockAction;

/** Motivo de la pausa. TRAVEL se registra como tramo de desplazamiento, no como descanso. */
export const PauseKind = { MEAL: 'MEAL', REST: 'REST', TRAVEL: 'TRAVEL' } as const;
export type PauseKind = keyof typeof PauseKind;

/** Longitud máxima de una nota de relevo. */
export const HANDOVER_NOTE_MAX = 1000;

export const clockSchema = z
  .object({
    action: z.enum(['START', 'PAUSE', 'RESUME', 'STOP']),
    pause: z.enum(['MEAL', 'REST', 'TRAVEL']).optional(),
    /** null si el dispositivo no pudo dar posición: el fichaje se admite igualmente. */
    position: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100000),
      })
      .nullable(),
    /** Hora del dispositivo, solo informativa: la oficial la pone el servidor. */
    clientTime: z.string().datetime(),
    /** Identificador único del evento, para no duplicarlo si se reintenta. */
    clientUuid: z.string().uuid(),
    /**
     * Solo en eventos registrados sin conexión: el instante en que ocurrió, que
     * pasa a ser la hora oficial. El tramo queda marcado como sincronizado después.
     */
    occurredAt: z.string().datetime().optional(),
    /** La empresa pide foto y no se puede hacer (sin cámara o sin permiso): el tramo queda señalado. */
    photoUnavailable: z.boolean().optional(),
    /** QR de la ubicación escaneado al fichar: prueba la presencia sin depender del GPS. */
    qr: z.object({ locationId: z.string().uuid(), code: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).optional(),
    /**
     * Nota de relevo, solo al terminar la jornada en una empresa. Sin destinatario la recibe
     * quien empiece el siguiente turno; con él, esa persona cuando inicie su jornada.
     */
    note: z.object({ text: z.string().trim().min(1).max(HANDOVER_NOTE_MAX), recipientId: z.string().uuid().nullable() }).optional(),
  })
  .refine((v) => v.action !== 'PAUSE' || v.pause !== undefined, { path: ['pause'] })
  .refine((v) => v.note === undefined || v.action === 'STOP', { path: ['note'] });
export type ClockInput = z.infer<typeof clockSchema>;

export const workdaysQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(62).default(14) });

export interface TimeSegmentDto {
  id: string;
  entryType: 'WORK' | 'BREAK' | 'TRAVEL';
  breakKind: 'MEAL' | 'REST' | 'OTHER' | null;
  startTime: string;
  endTime: string | null;
  origin: 'REALTIME' | 'MANUAL';
  locationName: string | null;
  locationColor: string | null;
  /** null = sin posición o sin ubicaciones con las que comparar. */
  isWithinGeofence: boolean | null;
  geofenceDistanceMeters: number | null;
  hasPosition: boolean;
  startAccuracy: number | null;
  startAddress: string | null;
  hasStartPhoto: boolean;
  hasEndPhoto: boolean;
  /** Registrado sin conexión y enviado después. */
  syncedOffline: boolean;
  presenceMethod: PresenceMethodId;
  /** La empresa pedía foto y no se hizo. */
  photoMissing: boolean;
}

export type PresenceMethodId = 'GPS' | 'QR' | 'KIOSK' | 'NONE';

export interface WorkdayDto {
  id: string;
  startedAt: string;
  /** null mientras la jornada sigue abierta. */
  endedAt: string | null;
  segments: TimeSegmentDto[];
  workedSeconds: number;
  breakSeconds: number;
  travelSeconds: number;
  /** true si algún tramo se introdujo a mano en lugar de con el cronómetro. */
  manual: boolean;
  approvalStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
  rejectionReason: string | null;
  /** Si es una corrección propuesta, la jornada a la que sustituiría. */
  replacesWorkdayId: string | null;
  locationId: string | null;
  /** Minutos de retraso sobre el turno, pasada la tolerancia; null si llegó a tiempo o sin turno. */
  lateMinutes: number | null;
}

export type ClockState = 'IDLE' | 'WORKING' | 'PAUSED';

export interface ClockStatus {
  /** Hora oficial: el cliente calcula con ella su desfase y el cronómetro. */
  serverTime: string;
  state: ClockState;
  workday: WorkdayDto | null;
  /** Turno en curso o el próximo de hoy, si lo hay. */
  shift: ShiftDto | null;
  /** La empresa exige foto al empezar y al terminar la jornada. */
  requirePhoto: boolean;
  /** Notas de relevo recibidas al iniciar la jornada y aún sin marcar como leídas. */
  notes: HandoverNoteDto[];
}

/** Nota de relevo tal como la ve quien la recibe. */
export interface HandoverNoteDto {
  id: string;
  text: string;
  author: PersonRef;
  createdAt: string;
  locationName: string | null;
  /** true si iba dirigida a esta persona; false si era para el siguiente turno. */
  direct: boolean;
}

/** Nota de relevo tal como la ve quien la escribió. */
export interface SentHandoverNoteDto {
  id: string;
  text: string;
  createdAt: string;
  /** Destinatario elegido; null si era para el siguiente turno. */
  recipient: PersonRef | null;
  /** Quién la ha recibido; null mientras nadie haya iniciado jornada. */
  deliveredTo: PersonRef | null;
  deliveredAt: string | null;
  readAt: string | null;
}

// ── Fichaje manual, correcciones y validación ────────────────────────────

const instant = z.string().datetime();

export const manualWorkdaySchema = z.object({
  /** Solo responsables: registrar la jornada de otra persona del equipo. */
  userId: z.string().uuid().optional(),
  start: instant,
  end: instant,
  breaks: z
    .array(z.object({ kind: z.enum(['MEAL', 'REST', 'TRAVEL']), start: instant, end: instant }))
    .max(12)
    .default([]),
  locationId: z.string().uuid().nullable().optional(),
  /** Obligatorio: queda en el historial de cambios. */
  reason: z.string().trim().min(5).max(500),
});
export type ManualWorkdayInput = z.infer<typeof manualWorkdaySchema>;

export const reviewSchema = z
  .object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(500).optional() })
  .refine((v) => v.decision === 'APPROVE' || (v.reason?.length ?? 0) >= 5, { path: ['reason'] });
export type ReviewInput = z.infer<typeof reviewSchema>;

export const rangeQuerySchema = z.object({ from: instant, to: instant });

export interface PersonRef {
  id: string;
  fullName: string;
}

/** Una jornada pendiente de validar, con la original si es una corrección. */
export interface ReviewItem {
  user: PersonRef;
  proposal: WorkdayDto;
  original: WorkdayDto | null;
  reason: string;
  requestedAt: string;
}

export interface TeamDayRow {
  user: PersonRef;
  state: ClockState;
  workdays: WorkdayDto[];
}

export const AuditAction = {
  CREATE_MANUAL: 'CREATE_MANUAL',
  CREATE_CORRECTION: 'CREATE_CORRECTION',
  VOID: 'VOID',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;
export type AuditAction = keyof typeof AuditAction;

export interface AuditValues {
  entryType?: 'WORK' | 'BREAK' | 'TRAVEL';
  startTime?: string;
  endTime?: string | null;
  approvalStatus?: 'APPROVED' | 'PENDING' | 'REJECTED';
  voided?: boolean;
}

export interface AuditEntryDto {
  id: string;
  action: AuditAction;
  changedBy: PersonRef;
  changedAt: string;
  reason: string;
  oldValues: AuditValues | null;
  newValues: AuditValues | null;
}

// ── Cuadrantes y bolsas de horas ─────────────────────────────────────────

export const shiftSchema = z.object({
  userId: z.string().uuid(),
  start: instant,
  end: instant,
  breakMinutes: z.number().int().min(0).max(480).default(0),
  locationId: z.string().uuid().nullable().optional(),
  notes: optionalText(300),
});
export type ShiftInput = z.infer<typeof shiftSchema>;

/** Varios turnos de una vez: el mismo horario repetido en varios días. */
export const createShiftsSchema = z.object({ shifts: z.array(shiftSchema).min(1).max(62) });
export const updateShiftSchema = shiftSchema.omit({ userId: true });
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

/** Copia los turnos de [from, to) desplazándolos `offsetDays` días, conservando la hora local. */
export const copyShiftsSchema = z.object({
  from: instant,
  to: instant,
  offsetDays: z.number().int().min(-371).max(371).refine((n) => n !== 0),
});
export type CopyShiftsInput = z.infer<typeof copyShiftsSchema>;

export interface ShiftDto {
  id: string;
  user: PersonRef;
  /** Día local (zona de la empresa) en el que empieza el turno: YYYY-MM-DD. */
  date: string;
  plannedStart: string;
  plannedEnd: string;
  breakMinutes: number;
  locationId: string | null;
  locationName: string | null;
  locationColor: string | null;
  notes: string | null;
  /** false = borrador: el empleado aún no lo ve. */
  published: boolean;
}

export interface HoursBag {
  /** Tiempo previsto según los turnos publicados, sin las pausas. */
  plannedSeconds: number;
  workedSeconds: number;
  /** Trabajado dentro de lo planificado. */
  ordinarySeconds: number;
  /** Trabajado por encima de lo planificado. */
  overtimeSeconds: number;
  /** Parte del trabajo que cae en el tramo nocturno. */
  nightSeconds: number;
  travelSeconds: number;
  breakSeconds: number;
  /** Lo planificado en días de ausencia aprobada: horas justificadas, no trabajadas. */
  absenceSeconds: number;
}

export interface DayHours extends HoursBag {
  date: string;
}

export interface UserHours {
  user: PersonRef;
  /** false si no tiene ningún turno en el periodo: todo cuenta como ordinario. */
  hasPlan: boolean;
  total: HoursBag;
  days: DayHours[];
  /** Días de ausencia aprobada en el periodo, por tipo. */
  absenceDays: Partial<Record<AbsenceTypeId, number>>;
  /** Festivos (días laborables) en el periodo. */
  holidays: number;
}

export const hoursQuerySchema = z.object({ from: instant, to: instant, scope: z.enum(['me', 'team']).default('me') });

// ── Gastos y tickets ─────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES = ['MEAL', 'FUEL', 'TOLL', 'LODGING', 'MATERIAL', 'MILEAGE', 'OTHER'] as const;
export type ExpenseCategoryId = (typeof EXPENSE_CATEGORIES)[number];

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Importe con dos decimales como mucho. */
const money = z
  .number()
  .min(0)
  .max(1_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6);

/** Lo que propone el OCR a partir de la foto; el usuario siempre lo revisa. */
export const ocrSuggestionSchema = z.object({
  provider: z.string().max(40),
  amount: money.nullable(),
  taxAmount: money.nullable(),
  date: calendarDate.nullable(),
  merchantName: z.string().max(120).nullable(),
  merchantTaxId: z.string().max(20).nullable(),
});
export type OcrSuggestion = z.infer<typeof ocrSuggestionSchema>;

export const expenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES),
    customCategoryId: z.string().uuid().nullable().optional(),
    /** En kilometraje lo calcula el servidor: kilómetros × tarifa. */
    amount: money.optional(),
    taxAmount: money.nullable().optional(),
    date: calendarDate,
    merchantName: optionalText(120),
    merchantTaxId: optionalText(20),
    paymentMethod: z.enum(['COMPANY_CARD', 'EMPLOYEE_PAID']).default('EMPLOYEE_PAID'),
    distanceKm: z.number().positive().max(5000).nullable().optional(),
    locationId: z.string().uuid().nullable().optional(),
    notes: optionalText(500),
    ocrData: ocrSuggestionSchema.nullable().optional(),
    /** Identificador del gasto en el dispositivo: reintentar el envío no lo duplica. */
    clientUuid: z.string().uuid().optional(),
  })
  .refine((v) => (v.category === 'MILEAGE' ? !!v.distanceKm : v.amount !== undefined && v.amount > 0), { path: ['amount'] })
  .refine((v) => v.taxAmount == null || v.amount === undefined || v.taxAmount <= v.amount, { path: ['taxAmount'] });
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const expenseRangeSchema = z.object({ from: calendarDate, to: calendarDate });
export const reimburseSchema = z.object({ userId: z.string().uuid(), from: calendarDate, to: calendarDate });
export const expenseCategorySchema = z.object({
  name: z.string().trim().min(2).max(40),
  baseCategory: z.enum(EXPENSE_CATEGORIES).default('OTHER'),
});

export interface ExpenseDto {
  id: string;
  user: PersonRef;
  category: ExpenseCategoryId;
  customCategoryId: string | null;
  customCategoryName: string | null;
  amount: number;
  taxAmount: number | null;
  currency: string;
  date: string;
  merchantName: string | null;
  merchantTaxId: string | null;
  paymentMethod: 'COMPANY_CARD' | 'EMPLOYEE_PAID';
  distanceKm: number | null;
  locationId: string | null;
  locationName: string | null;
  notes: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REIMBURSED';
  rejectionReason: string | null;
  hasReceipt: boolean;
  reviewedBy: string | null;
  reimbursedAt: string | null;
}

export interface CustomCategoryDto {
  id: string;
  name: string;
  baseCategory: ExpenseCategoryId;
  isActive: boolean;
}

/** Liquidación de una persona en un periodo. */
export interface ExpenseSummaryRow {
  user: PersonRef;
  count: number;
  /** Esperando validación. */
  pending: number;
  /** Aprobado y adelantado por el empleado: lo que se le debe. */
  toReimburse: number;
  reimbursed: number;
  /** Aprobado y pagado con tarjeta de empresa: no se reembolsa. */
  companyCard: number;
  rejected: number;
}

export interface ExpenseConfig {
  currency: string;
  mileageRatePerKm: number;
  customCategories: CustomCategoryDto[];
}

// ── Documentos y firma ───────────────────────────────────────────────────

export const DOCUMENT_CATEGORIES = ['PAYROLL', 'CONTRACT', 'SAFETY', 'CERTIFICATE', 'ANNOUNCEMENT', 'MEDICAL_LEAVE', 'TIMESHEET', 'OTHER'] as const;
export type DocumentCategoryId = (typeof DOCUMENT_CATEGORIES)[number];

/** Lo que un empleado puede enviar a sus responsables. */
export const EMPLOYEE_DOCUMENT_CATEGORIES = ['MEDICAL_LEAVE', 'CERTIFICATE', 'OTHER'] as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const sendDocumentSchema = z.object({
  title: z.string().trim().min(2).max(140),
  category: z.enum(DOCUMENT_CATEGORIES),
  requiresSignature: z.boolean().default(false),
  /** 'ALL' = toda la plantilla activa; 'MANAGERS' = los responsables (envío de un empleado). */
  recipients: z.union([
    z.literal('ALL'),
    z.literal('MANAGERS'),
    z.object({ departmentId: z.string().uuid() }),
    z.array(z.string().uuid()).min(1).max(500),
  ]),
  /** Fecha límite para leerlo o firmarlo (AAAA-MM-DD): se recuerda 3 días antes, el día y después. */
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type SendDocumentInput = z.infer<typeof sendDocumentSchema>;

export const signDocumentSchema = z.object({
  /** Rúbrica dibujada, como PNG en data URL. */
  signature: z
    .string()
    .max(400_000)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  /** Número de trazos y puntos: prueba de que se dibujó, no se pegó. */
  strokes: z.number().int().min(1).max(500),
  points: z.number().int().min(8).max(100_000),
});
export type SignDocumentInput = z.infer<typeof signDocumentSchema>;

export interface SignatureAudit {
  signerName: string;
  signerDni: string;
  signedAt: string;
  ip: string | null;
  userAgent: string | null;
  /** SHA-256 del archivo original que se firmó. */
  originalSha256: string;
  /** SHA-256 del PDF firmado resultante. */
  signedSha256: string;
  strokes: number;
  points: number;
}

export interface DocumentDto {
  id: string;
  batchId: string | null;
  title: string;
  category: DocumentCategoryId;
  sender: PersonRef;
  recipient: PersonRef;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  requiresSignature: boolean;
  status: 'SENT' | 'VIEWED' | 'SIGNED';
  createdAt: string;
  viewedAt: string | null;
  signedAt: string | null;
  audit: SignatureAudit | null;
  dueDate: string | null;
  /** Pasada la fecha límite sin leer (o sin firmar, si se pide firma). */
  overdue: boolean;
  /** Mes del registro de jornada mensual (AAAA-MM). */
  period: string | null;
}

// ── Nóminas en un solo PDF ───────────────────────────────────────────────

export interface PayrollPage {
  page: number;
  /** DNI/NIE encontrado en la página. */
  dni: string | null;
  /** Persona de la empresa con ese DNI, si la hay. */
  userId: string | null;
}

export interface PayrollAnalysis {
  id: string;
  fileName: string;
  pageCount: number;
  expiresAt: string;
  pages: PayrollPage[];
  /** Personas de la empresa (para asignar a mano las páginas sin dueño). */
  people: { userId: string; fullName: string; dniNie: string | null }[];
}

export const payrollSendSchema = z.object({
  title: z.string().trim().min(2).max(140),
  /** Página → persona. Las páginas que no aparecen no se envían. */
  assignments: z.array(z.object({ page: z.number().int().min(1).max(5000), userId: z.string().uuid() })).min(1).max(5000),
});
export type PayrollSendInput = z.infer<typeof payrollSendSchema>;

export const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

export interface TimesheetsSent {
  sent: number;
  /** Ya lo tenían de ese mes. */
  skipped: number;
}

// ── Correo de avisos ─────────────────────────────────────────────────────

export const emailPrefsSchema = z.object({
  documents: z.boolean(),
  requests: z.boolean(),
  pending: z.boolean(),
  schedule: z.boolean(),
  alerts: z.boolean(),
  digest: z.boolean(),
});

// ── Informes ─────────────────────────────────────────────────────────────

export const reportQuerySchema = z.object({
  /** Mes natural: YYYY-MM. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** Solo quien supervisa: informe de otra persona del equipo. */
  userId: z.string().uuid().optional(),
  format: z.enum(['pdf', 'xlsx', 'csv']).default('pdf'),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** Registro de toda la plantilla de un mes: Excel con un resumen y una hoja por persona, o un PDF con todos. */
export const teamReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  format: z.enum(['pdf', 'xlsx']).default('xlsx'),
});
export type TeamReportQuery = z.infer<typeof teamReportQuerySchema>;

// ── Notificaciones ───────────────────────────────────────────────────────

export const NOTIFICATION_TYPES = [
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
] as const;
export type NotificationTypeId = (typeof NOTIFICATION_TYPES)[number];

/** Datos para componer el texto del aviso en el idioma de quien lo lee, y su destino. */
export interface NotificationPayload {
  /** Ruta de la app a la que lleva el aviso. */
  link: string;
  /** Persona que origina el aviso. */
  name?: string;
  title?: string;
  count?: number;
  amount?: string;
  approved?: boolean;
  requiresSignature?: boolean;
  /** Alertas de jornada: tipo y datos para el texto. */
  alertKind?: AlertKindId;
  hours?: number;
  minutes?: number;
  /** Recordatorio de un documento: fecha límite (AAAA-MM-DD) y si ya ha vencido. */
  dueDate?: string;
  overdue?: boolean;
  /** Ausencias: tipo y fechas (AAAA-MM-DD). */
  absenceType?: AbsenceTypeId;
  from?: string;
  to?: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationTypeId;
  organizationId: string | null;
  organizationName: string | null;
  payload: NotificationPayload;
  read: boolean;
  createdAt: string;
}

export interface NotificationList {
  unread: number;
  items: NotificationDto[];
}

export const markReadSchema = z.object({ ids: z.array(z.string().uuid()).max(200).optional() });

/**
 * El servidor envía peticiones a esta dirección: solo https y nunca un equipo interno
 * (IP, localhost o nombres sin dominio público), para que no sirva de puente hacia la red propia.
 */
export function isPublicPushEndpoint(value: string): boolean {
  // Sin credenciales, sin puerto distinto del 443 y con un nombre de dominio público.
  const m = /^https:\/\/([^/?#@:\s]+)(?::443)?(?:[/?#]|$)/i.exec(value);
  if (!m) return false;
  const host = m[1]!.toLowerCase();
  if (/^[0-9.]+$/.test(host) || host.startsWith('[')) return false;
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return false;
  return true;
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).refine(isPublicPushEndpoint),
  keys: z.object({ p256dh: z.string().min(1).max(300), auth: z.string().min(1).max(300) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

// ── Panel y ajustes de empresa ───────────────────────────────────────────

export interface DashboardDto {
  /** Lo que requiere mi atención. */
  me: { documentsPending: number; nextShift: ShiftDto | null };
  /** Solo para quien supervisa. */
  team: {
    members: number;
    clockedIn: number;
    onBreak: number;
    pendingTimeEntries: number;
    pendingExpenses: number;
    documentsAwaiting: number;
    pendingAbsences: number;
    /** Personas ausentes hoy (vacaciones, baja...). */
    absentToday: number;
    openAlerts: number;
  } | null;
}

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const organizationSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  taxId: optionalText(20),
  timezone: z.string().min(3).max(60),
  nightStart: clock,
  nightEnd: clock,
  mileageRatePerKm: z.number().min(0).max(5),
  allowEmployeeManualEntries: z.boolean(),
  defaultGeofenceRadiusMeters: z.number().int().min(GEOFENCE_MIN_METERS).max(GEOFENCE_MAX_METERS),
  // Opcionales: un cliente que no los envíe conserva lo guardado.
  region: z.string().regex(/^(ES-[A-Z]{2})?$/).optional(),
  requirePhotoOnClock: z.boolean().optional(),
  lateToleranceMinutes: z.number().int().min(0).max(120).optional(),
  alertsEnabled: z.boolean().optional(),
  missedClockInMinutes: z.number().int().min(5).max(240).optional(),
  maxOpenHours: z.number().int().min(4).max(24).optional(),
  overtimeYearLimit: z.number().int().min(0).max(1000).optional(),
  vacationDays: z.number().int().min(0).max(60).optional(),
  vacationUnit: z.enum(['WORKING', 'NATURAL']).optional(),
  photoRetentionMonths: z.number().int().min(0).max(120).optional(),
  quietHours: z.object({ enabled: z.boolean(), start: clock, end: clock, weekends: z.boolean() }).optional(),
  geoNoticeText: z.string().trim().max(1500).optional(),
  monthlyTimesheet: z.object({ enabled: z.boolean(), day: z.number().int().min(1).max(28), requireSignature: z.boolean() }).optional(),
  payrollColumns: z
    .array(z.enum(PAYROLL_COLUMNS))
    .min(1)
    .max(PAYROLL_COLUMNS.length)
    .refine((v) => new Set(v).size === v.length)
    .optional(),
  overtimeSurchargePct: z.number().min(0).max(200).optional(),
  brandName: z.string().trim().max(80).optional(),
  accentColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).optional(),
});
export type OrganizationSettingsInput = z.infer<typeof organizationSettingsSchema>;

export interface OrganizationDto extends Required<OrganizationSettingsInput> {
  id: string;
  currency: string;
  hasLogo: boolean;
}

/** Aviso previo al uso de la geolocalización al fichar (art. 90 LOPDGDD). */
export interface GeoNoticeDto {
  /** false en el espacio personal: los datos son de uno mismo. */
  required: boolean;
  accepted: boolean;
  organizationName: string | null;
  /** Texto propio de la empresa, además del general. */
  companyText: string;
  photoRetentionMonths: number;
}

/** Datos del responsable del sitio, para las páginas legales (variables LEGAL_*). */
export interface LegalInfo {
  name: string;
  taxId: string;
  address: string;
  email: string;
  /** Proveedor tecnológico que presta el servicio (encargado del tratamiento), si es otro. */
  provider: string;
  /** Subencargados propios de esta instalación (p. ej. el alojamiento), para el encargo de tratamiento. */
  subprocessors: string[];
}

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Token del enlace del correo: 32 bytes en base64url. */
const resetToken = linkToken;
export const checkResetSchema = z.object({ token: resetToken });
export const resetPasswordSchema = z.object({ token: resetToken, newPassword: password });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ── Instalación y sesiones ──────────────────────────────────────────────

/**
 * demo: la demo pública. client: el servidor de un cliente (una empresa, solo con invitación).
 * open: registro libre con verificación del correo.
 */
export type DeployMode = 'demo' | 'client' | 'open';

export interface DemoAccount {
  role: Role;
  email: string;
  fullName: string;
}

/** Datos públicos de la instalación (GET /meta, sin sesión). */
export interface AppMeta {
  mode: DeployMode;
  appName: string;
  version: string;
  /** Solo en la demo: las cuentas para entrar con un clic. */
  demo: { password: string; kioskPin: string; accounts: DemoAccount[] } | null;
  /** Responsable del sitio para el aviso legal y la política de privacidad; null si no se ha configurado. */
  legal: LegalInfo | null;
}

export const verifyEmailSchema = z.object({ token: linkToken });

/** Un dispositivo con la sesión abierta (una cadena de tokens de renovación). */
export interface SessionDto {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

// ── Festivos y ausencias ────────────────────────────────────────────────

export const HOLIDAY_SCOPES = ['NATIONAL', 'REGIONAL', 'LOCAL'] as const;
export type HolidayScopeId = (typeof HOLIDAY_SCOPES)[number];

export interface HolidayDto {
  id: string;
  date: string;
  name: string;
  scope: HolidayScopeId;
  /** Solo los locales: la ubicación a la que afecta; null = toda la empresa. */
  location: { id: string; name: string } | null;
}

export const holidaySchema = z.object({
  date: calendarDate,
  name: z.string().trim().min(2).max(80),
  scope: z.enum(HOLIDAY_SCOPES),
  locationId: z.string().uuid().nullable().optional(),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

export const holidayImportSchema = z.object({ year: z.number().int().min(2000).max(2100) });
export const yearQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

export const ABSENCE_TYPES = ['VACATION', 'PERSONAL', 'SICK_LEAVE', 'PAID_LEAVE', 'UNPAID', 'OTHER'] as const;
export type AbsenceTypeId = (typeof ABSENCE_TYPES)[number];
export type AbsenceStatusId = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export const absenceSchema = z
  .object({
    type: z.enum(ABSENCE_TYPES),
    startDate: calendarDate,
    endDate: calendarDate,
    /** Solo en ausencias de un día. */
    halfDay: z.boolean().default(false),
    reason: optionalText(500),
    /** Solo responsables: registrar la ausencia de otra persona (queda aprobada). */
    userId: z.string().uuid().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'] })
  .refine((v) => !v.halfDay || v.startDate === v.endDate, { path: ['halfDay'] });
export type AbsenceInput = z.infer<typeof absenceSchema>;

export const absenceReviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().max(500).optional(),
    /** Al aprobar: quitar los turnos que la persona tenía esos días. */
    removeShifts: z.boolean().optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || (v.reason?.length ?? 0) >= 5, { path: ['reason'] });
export type AbsenceReviewInput = z.infer<typeof absenceReviewSchema>;

export const absenceRangeSchema = z.object({ from: calendarDate, to: calendarDate, userId: z.string().uuid().optional() });

export interface AbsenceDto {
  id: string;
  user: PersonRef;
  type: AbsenceTypeId;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  /** Días que consume, según la empresa (laborables o naturales). */
  days: number;
  status: AbsenceStatusId;
  reason: string | null;
  hasAttachment: boolean;
  reviewedBy: PersonRef | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  /** Turnos publicados que la persona tiene esos días. */
  conflictingShifts: number;
}

export interface VacationBalance {
  year: number;
  allowance: number;
  unit: 'WORKING' | 'NATURAL';
  /** Aprobadas y disfrutadas o por disfrutar. */
  used: number;
  /** Pedidas, a falta de aprobar. */
  pending: number;
  remaining: number;
}

/** Calendario de un periodo: festivos y ausencias aprobadas (o pendientes) del equipo. */
export interface TeamCalendar {
  holidays: HolidayDto[];
  absences: AbsenceDto[];
}

// ── Alertas de jornada ──────────────────────────────────────────────────

export const ALERT_KINDS = ['MISSED_CLOCK_IN', 'LONG_WORKDAY', 'SHORT_REST', 'LONG_ORDINARY_DAY', 'OVERTIME_YEAR_70', 'OVERTIME_YEAR_100'] as const;
export type AlertKindId = (typeof ALERT_KINDS)[number];

export interface AlertDto {
  id: string;
  user: PersonRef;
  kind: AlertKindId;
  /** Día al que se refiere (AAAA-MM-DD). */
  date: string;
  /** Horas, minutos o turno, según el tipo. */
  data: { hours?: number; minutes?: number; plannedStart?: string; limit?: number };
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: PersonRef | null;
}

// ── Quiosco de fichaje ──────────────────────────────────────────────────

export interface KioskDeviceDto {
  id: string;
  name: string;
  location: { id: string; name: string } | null;
  paired: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export const kioskSchema = z.object({ name: z.string().trim().min(2).max(60), locationId: z.string().uuid().nullable().optional() });
export type KioskInput = z.infer<typeof kioskSchema>;

/** Código para emparejar la tablet, que se ve una sola vez. */
export interface KioskPairingDto {
  kiosk: KioskDeviceDto;
  code: string;
  expiresAt: string;
}

export const kioskPairSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8}$/) });

/** Lo que la tablet sabe de sí misma tras emparejarse. */
export interface KioskInfo {
  name: string;
  organizationName: string;
  locationName: string | null;
  requirePhoto: boolean;
  people: { membershipId: string; fullName: string }[];
}

const pin = z.string().regex(/^\d{4,6}$/);
export const kioskPinSchema = z.object({ pin });

export const kioskIdentifySchema = z
  .object({ membershipId: z.string().uuid().optional(), cardCode: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(), pin })
  .refine((v) => !!v.membershipId !== !!v.cardCode);
export type KioskIdentifyInput = z.infer<typeof kioskIdentifySchema>;

export interface KioskIdentity {
  /** Autoriza a fichar por esa persona durante un rato (o al enviar lo guardado sin conexión). */
  token: string;
  fullName: string;
  state: ClockState;
}

export const kioskClockSchema = z.object({
  token: z.string().min(20).max(2000),
  action: z.enum(['START', 'PAUSE', 'RESUME', 'STOP']),
  pause: z.enum(['MEAL', 'REST', 'TRAVEL']).optional(),
  clientTime: z.string().datetime(),
  clientUuid: z.string().uuid(),
  occurredAt: z.string().datetime().optional(),
  photoUnavailable: z.boolean().optional(),
});
export type KioskClockInput = z.infer<typeof kioskClockSchema>;

// ── Gestoría y coste por obra ────────────────────────────────────────────

export const payrollExportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});
export type PayrollExportQuery = z.infer<typeof payrollExportQuerySchema>;

export const siteCostQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });

/** Horas, coste estimado y gastos de una ubicación en un mes (o lo que no tiene ubicación). */
export interface SiteCostRow {
  location: { id: string; name: string; color: string | null } | null;
  workedSeconds: number;
  /** Personas distintas que trabajaron allí. */
  people: number;
  /** Coste de las horas con el coste por hora de cada persona (y el recargo de las extra). */
  laborCost: number;
  /** Gastos aprobados o pagados, por categoría. */
  expenses: Partial<Record<ExpenseCategoryId, number>>;
  expensesTotal: number;
}

export interface SiteCostReport {
  month: string;
  currency: string;
  rows: SiteCostRow[];
  total: { workedSeconds: number; laborCost: number; expensesTotal: number };
  /** Personas con horas en el mes pero sin coste por hora: su coste no se cuenta. */
  missingRates: PersonRef[];
}

// ── Turnos rotativos ─────────────────────────────────────────────────────

/** Un día del ciclo: turno (hora local) o libre (null). */
export const patternDaySchema = z
  .object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    breakMinutes: z.number().int().min(0).max(480).default(0),
    locationId: z.string().uuid().nullable().optional(),
  })
  .nullable();
export type PatternDay = z.infer<typeof patternDaySchema>;

export const shiftPatternSchema = z.object({
  name: z.string().trim().min(2).max(60),
  days: z.array(patternDaySchema).min(1).max(28).refine((d) => d.some((x) => x !== null)),
});
export type ShiftPatternInput = z.infer<typeof shiftPatternSchema>;

export interface ShiftPatternDto {
  id: string;
  name: string;
  days: PatternDay[];
}

export const applyPatternSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(200),
  /** Primer día del ciclo (AAAA-MM-DD) para la primera persona. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weeks: z.number().int().min(1).max(26),
  /** Desfase en días entre una persona y la siguiente (0 = todas igual). */
  stagger: z.number().int().min(0).max(27).default(0),
});
export type ApplyPatternInput = z.infer<typeof applyPatternSchema>;

export interface ApplyPatternResult {
  created: number;
  /** Días que no se han creado: festivo, ausencia aprobada o ya había turno. */
  skipped: { holiday: number; absence: number; overlap: number };
}
