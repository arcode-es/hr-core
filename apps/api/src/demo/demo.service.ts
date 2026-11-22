import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_ORGANIZATION_SETTINGS, type ExpenseInput, resolveSettings, type Role } from '@hr/shared';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import type { RequestMeta, WorkspaceContext } from '../common/context';
import { fromWallTime, localDate, parseClock } from '../common/tz';
import type { Env } from '../config/env';
import { Deployment } from '../deployment/deployment';
import { AbsencesService } from '../absences/absences.service';
import { DocumentJobsService } from '../documents/document-jobs.service';
import { DocumentsService } from '../documents/documents.service';
import { ExpensesService } from '../expenses/expenses.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftsService } from '../shifts/shifts.service';
import { Storage } from '../storage/storage';
import { CorrectionsService } from '../time/corrections.service';
import { DEMO_ACCOUNTS, DEMO_KIOSK_PIN, DEMO_ORGANIZATION, DEMO_EMAIL_DOMAIN } from './accounts';
import { payslipPdf, seeded, signaturePng, textPdf } from './assets';
import { jpeg, RECEIPT_FUEL, RECEIPT_HARDWARE, RECEIPT_MEAL, SITE_A, SITE_B } from './images';

const TZ = 'Europe/Madrid';
/** Dirección de documentación (TEST-NET-1): nunca es la IP de nadie. */
const DEMO_META: RequestMeta = { ip: '192.0.2.10', userAgent: 'HR-Core demo' };

type Person = 'admin' | 'manager' | 'luis' | 'ana' | 'inspector';
const PEOPLE: Person[] = ['admin', 'manager', 'luis', 'ana', 'inspector'];

const PROFILE: Record<Person, { dni: number; phone: string; jobTitle: string }> = {
  admin: { dni: 48291736, phone: '600 111 222', jobTitle: 'Administración y RR. HH.' },
  manager: { dni: 53718204, phone: '600 333 444', jobTitle: 'Jefe de obra' },
  luis: { dni: 20946371, phone: '600 555 666', jobTitle: 'Oficial de primera' },
  ana: { dni: 29573618, phone: '600 777 888', jobTitle: 'Encargada de reformas' },
  inspector: { dni: 71840265, phone: '600 999 000', jobTitle: 'Representante de los trabajadores' },
};

/** DNI con su letra de control correcta, para que la firma de documentos lo acepte. */
const dni = (n: number): string => `${n}${'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23]}`;

const SITES = [
  { key: 'puerto', name: 'Obra Av. del Puerto 112', address: 'Av. del Puerto 112, 46023 Valencia', lat: 39.4624, lng: -0.348, radius: 150, color: '#4f46e5' },
  { key: 'colon', name: 'Reforma C/ Colón 24', address: 'Carrer de Colón 24, 46004 Valencia', lat: 39.4699, lng: -0.3733, radius: 100, color: '#0c8f63' },
  { key: 'nave', name: 'Nave Fuente del Jarro', address: 'Polígono Fuente del Jarro, 46988 Paterna', lat: 39.5216, lng: -0.4447, radius: 250, color: '#d97706' },
  { key: 'oficina', name: 'Oficina central', address: 'Carrer de la Pau 5, 46002 Valencia', lat: 39.4752, lng: -0.3774, radius: 80, color: '#0891b2' },
] as const;
type SiteKey = (typeof SITES)[number]['key'];

/** Quién trabaja dónde y en qué horario (hora local). */
const PLAN: Partial<Record<Person, { site: SiteKey; start: string; end: string; breakMinutes: number }>> = {
  manager: { site: 'oficina', start: '08:00', end: '17:00', breakMinutes: 60 },
  luis: { site: 'puerto', start: '07:00', end: '15:00', breakMinutes: 30 },
  ana: { site: 'colon', start: '08:00', end: '16:00', breakMinutes: 30 },
};

const addDays = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};
const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();
const isWorkday = (date: string): boolean => weekday(date) >= 1 && weekday(date) <= 5;

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Instante de una hora local de un día, con minutos de más o de menos. */
function at(date: string, hhmm: string, plusMinutes = 0): Date {
  const [year, month, day] = date.split('-').map(Number);
  const { hour, minute } = parseClock(hhmm);
  return fromWallTime({ year: year!, month: month!, day: day!, hour, minute: minute + plusMinutes }, TZ);
}

/** Un punto a unos metros de otro (al fichar no se está en el centro exacto). */
function near(lat: number, lng: number, metersNorth: number, metersEast: number): { lat: number; lng: number } {
  return { lat: lat + metersNorth / 111_320, lng: lng + metersEast / (111_320 * Math.cos((lat * Math.PI) / 180)) };
}

/**
 * La demo pública: una empresa ficticia con tres semanas de actividad. Cada noche
 * se borra y se vuelve a sembrar, así cada visitante la encuentra igual.
 */
@Injectable()
export class DemoService implements OnModuleInit, OnApplicationBootstrap {
  private readonly log = new Logger('Demo');
  private readonly password: string;
  private readonly jobsEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: Storage,
    private readonly deployment: Deployment,
    private readonly jobs: JobsService,
    private readonly shifts: ShiftsService,
    private readonly corrections: CorrectionsService,
    private readonly expenses: ExpensesService,
    private readonly documents: DocumentsService,
    private readonly absences: AbsencesService,
    private readonly documentJobs: DocumentJobsService,
    config: ConfigService<Env, true>,
  ) {
    this.password = config.get('DEMO_PASSWORD', { infer: true });
    this.jobsEnabled = config.get('JOBS_ENABLED', { infer: true });
  }

  onModuleInit(): void {
    if (!this.deployment.isDemo) return;
    this.jobs.register({ name: 'restablecer-demo', schedule: { dailyAt: '03:00' }, run: (now) => this.reset(now) });
  }

  /** Primer arranque de la demo: si aún no hay empresa demo, se siembra sin esperar a la noche. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.deployment.isDemo || !this.jobsEnabled) return;
    if (await this.prisma.organization.count({ where: { isDemo: true } })) return;
    await this.reset(new Date()).catch((e: unknown) => this.log.error(`No se pudo sembrar la demo: ${e instanceof Error ? e.message : String(e)}`));
  }

  async reset(now: Date): Promise<void> {
    const started = Date.now();
    await this.purge();
    await this.seed(now);
    this.log.log(`Demo restablecida en ${Date.now() - started} ms`);
  }

  /**
   * Borra la empresa demo y todo lo suyo, archivos incluidos. Los fichajes solo se
   * pueden borrar porque la empresa está marcada como demo y la transacción activa
   * la purga: ver la migración production_demo_security.
   */
  async purge(): Promise<void> {
    const keys = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('hr.demo_purge', 'on', true)`;
        const ids = (await tx.organization.findMany({ where: { isDemo: true }, select: { id: true } })).map((o) => o.id);
        if (!ids.length) return [];
        const org = { organizationId: { in: ids } };
        const [entries, expenses, documents, absences, payroll, orgs] = await Promise.all([
          tx.timeEntry.findMany({ where: org, select: { startPhotoKey: true, endPhotoKey: true } }),
          tx.expense.findMany({ where: org, select: { receiptPhotoKey: true } }),
          tx.document.findMany({ where: org, select: { originalFileKey: true, signedFileKey: true } }),
          tx.absence.findMany({ where: org, select: { attachmentKey: true } }),
          tx.payrollImport.findMany({ where: org, select: { fileKey: true } }),
          tx.organization.findMany({ where: { id: { in: ids } }, select: { settings: true } }),
        ]);
        await tx.timeEntryAudit.deleteMany({ where: { timeEntry: org } });
        await tx.timeEntry.deleteMany({ where: org });
        await tx.expense.deleteMany({ where: org });
        await tx.document.deleteMany({ where: org });
        await tx.notification.deleteMany({ where: org });
        // El resto (miembros, invitaciones, ubicaciones, turnos, categorías) cae en cascada.
        await tx.organization.deleteMany({ where: { id: { in: ids } } });
        return [
          ...entries.flatMap((e) => [e.startPhotoKey, e.endPhotoKey]),
          ...expenses.map((e) => e.receiptPhotoKey),
          ...documents.flatMap((d) => [d.originalFileKey, d.signedFileKey]),
          ...absences.map((a) => a.attachmentKey),
          ...payroll.map((p) => p.fileKey),
          ...orgs.map((o) => resolveSettings(o.settings).logoKey),
        ].filter((k): k is string => !!k);
      },
      { timeout: 120_000 },
    );
    if (keys.length) await this.storage.delete([...new Set(keys)]).catch((e: unknown) => this.log.warn(`Archivos de la demo sin borrar: ${String(e)}`));
  }

  async seed(now: Date): Promise<void> {
    const rnd = seeded(20261112);
    const today = localDate(now, TZ);

    // ── Personas ──────────────────────────────────────────────────────────
    const passwordHash = await argon2.hash(this.password);
    const users = {} as Record<Person, { id: string; fullName: string }>;
    for (const [i, person] of PEOPLE.entries()) {
      const account = DEMO_ACCOUNTS[i]!;
      const data = {
        fullName: account.fullName,
        passwordHash,
        dniNie: dni(PROFILE[person].dni),
        phone: PROFILE[person].phone,
        locale: 'es',
        timezone: TZ,
        active: true,
        failedLogins: 0,
        lockedUntil: null,
        emailVerifiedAt: now,
      };
      const user = await this.prisma.user.upsert({ where: { email: account.email }, create: { email: account.email, ...data }, update: data });
      users[person] = { id: user.id, fullName: user.fullName };
    }
    const ids = PEOPLE.map((p) => users[p].id);
    // Se cierran las sesiones del día anterior y se limpian sus avisos personales.
    await this.prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await this.prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await this.prisma.pushSubscription.deleteMany({ where: { userId: { in: ids } } });

    // ── Empresa y equipo ──────────────────────────────────────────────────
    const org = await this.prisma.organization.create({
      data: {
        ...DEMO_ORGANIZATION,
        isDemo: true,
        settings: {
          ...DEFAULT_ORGANIZATION_SETTINGS,
          timezone: TZ,
          quietHours: { enabled: true, start: '20:00', end: '07:00', weekends: true },
          region: 'ES-VC',
          geoNoticeText: 'La ubicación de los fichajes solo la consultan el jefe de obra y Administración, y únicamente para comprobar la asistencia a cada obra.',
          monthlyTimesheet: { enabled: true, day: 3, requireSignature: true },
          overtimeSurchargePct: 25,
        },
      },
    });
    const ws = {} as Record<Person, WorkspaceContext>;
    // Todas las cuentas que fichan tienen el mismo PIN de quiosco, público como la contraseña.
    const kioskPinHash = await argon2.hash(DEMO_KIOSK_PIN);
    for (const [i, person] of PEOPLE.entries()) {
      const role = DEMO_ACCOUNTS[i]!.role as Role;
      const m = await this.prisma.membership.create({
        data: { userId: users[person].id, organizationId: org.id, role, jobTitle: PROFILE[person].jobTitle, weeklyHours: 40, kioskPinHash: role === 'INSPECTOR' ? null : kioskPinHash },
      });
      ws[person] = { kind: 'organization', organizationId: org.id, role, membershipId: m.id };
    }

    // Departamentos: el jefe de obra dirige «Obra» y solo ve a su gente; Administración, a todos.
    const obra = await this.prisma.department.create({ data: { organizationId: org.id, name: 'Obra' } });
    const oficina = await this.prisma.department.create({ data: { organizationId: org.id, name: 'Oficina' } });
    await this.prisma.membership.updateMany({ where: { id: { in: [ws.manager, ws.luis, ws.ana].map((w) => (w as { membershipId: string }).membershipId) } }, data: { departmentId: obra.id } });
    await this.prisma.membership.updateMany({ where: { id: (ws.admin as { membershipId: string }).membershipId }, data: { departmentId: oficina.id } });
    await this.prisma.departmentManager.create({ data: { departmentId: obra.id, membershipId: (ws.manager as { membershipId: string }).membershipId } });
    // Coste por hora (salario y cotizaciones) para el coste por obra.
    for (const [person, cost] of [['admin', 27], ['manager', 26.5], ['luis', 19.8], ['ana', 21.4]] as const) {
      await this.prisma.membership.update({ where: { id: (ws[person] as { membershipId: string }).membershipId }, data: { hourlyCost: cost } });
    }
    // Dos altas preparadas con la plantilla de alta masiva, aún sin aceptar.
    for (const [email, fullName, departmentId, jobTitle, weeklyHours] of [
      [`pablo.herrero@${DEMO_EMAIL_DOMAIN}`, 'Pablo Herrero Lillo', obra.id, 'Peón especialista', 40],
      [`marta.soler@${DEMO_EMAIL_DOMAIN}`, 'Marta Soler Ibáñez', oficina.id, 'Administrativa', 20],
    ] as const) {
      await this.prisma.invitation.create({
        data: {
          organizationId: org.id,
          email,
          fullName,
          departmentId,
          jobTitle,
          weeklyHours,
          role: 'EMPLOYEE',
          invitedById: users.admin.id,
          tokenHash: randomBytes(24).toString('hex'),
          expiresAt: new Date(now.getTime() + 6 * 86_400_000),
          lastSentAt: new Date(now.getTime() - 86_400_000),
          createdAt: new Date(now.getTime() - 86_400_000),
        },
      });
    }

    const sites = {} as Record<SiteKey, { id: string; lat: number; lng: number; address: string }>;
    for (const s of SITES) {
      const loc = await this.prisma.location.create({
        data: { organizationId: org.id, name: s.name, address: s.address, latitude: s.lat, longitude: s.lng, geofenceRadiusMeters: s.radius, color: s.color, qrCode: randomBytes(18).toString('base64url') },
      });
      sites[s.key] = { id: loc.id, lat: s.lat, lng: s.lng, address: s.address };
    }
    await this.prisma.customExpenseCategory.create({ data: { organizationId: org.id, name: 'Equipos de protección (EPI)', baseCategory: 'MATERIAL' } });
    // Un patrón de turnos rotativos listo para aplicar desde el cuadrante.
    await this.prisma.shiftPattern.create({
      data: {
        organizationId: org.id,
        name: 'Mañana, mañana, tarde, tarde, libre, libre',
        days: [
          { start: '07:00', end: '15:00', breakMinutes: 30, locationId: sites.puerto.id },
          { start: '07:00', end: '15:00', breakMinutes: 30, locationId: sites.puerto.id },
          { start: '14:00', end: '22:00', breakMinutes: 30, locationId: sites.nave.id },
          { start: '14:00', end: '22:00', breakMinutes: 30, locationId: sites.nave.id },
          null,
          null,
        ],
      },
    });
    // Un quiosco sin emparejar: desde Empresa se genera el código y se prueba en otra pestaña.
    await this.prisma.kioskDevice.create({ data: { organizationId: org.id, name: 'Tablet de la nave', locationId: sites.nave.id } });

    // ── Calendario laboral: este año y el siguiente ────────────────────────
    const year = Number(today.slice(0, 4));
    const valenciaCity = [sites.puerto.id, sites.colon.id, sites.oficina.id];
    await this.prisma.holiday.createMany({
      data: [year, year + 1].flatMap((y) => {
        const easter = easterSunday(y);
        const holiday = (date: string, name: string, scope: 'NATIONAL' | 'REGIONAL') => ({ organizationId: org.id, date: new Date(`${date}T00:00:00Z`), name, scope });
        return [
          holiday(`${y}-01-01`, 'Año Nuevo', 'NATIONAL'),
          holiday(`${y}-01-06`, 'Epifanía del Señor', 'NATIONAL'),
          holiday(addDays(easter, -2), 'Viernes Santo', 'NATIONAL'),
          holiday(`${y}-05-01`, 'Fiesta del Trabajo', 'NATIONAL'),
          holiday(`${y}-08-15`, 'Asunción de la Virgen', 'NATIONAL'),
          holiday(`${y}-10-12`, 'Fiesta Nacional de España', 'NATIONAL'),
          holiday(`${y}-11-01`, 'Todos los Santos', 'NATIONAL'),
          holiday(`${y}-12-06`, 'Día de la Constitución', 'NATIONAL'),
          holiday(`${y}-12-08`, 'Inmaculada Concepción', 'NATIONAL'),
          holiday(`${y}-12-25`, 'Navidad', 'NATIONAL'),
          holiday(`${y}-03-19`, 'San José', 'REGIONAL'),
          holiday(addDays(easter, 1), 'Lunes de Pascua', 'REGIONAL'),
          holiday(`${y}-10-09`, 'Día de la Comunitat Valenciana', 'REGIONAL'),
          // Fiestas locales de Valencia ciudad: no afectan a la nave de Paterna.
          ...valenciaCity.flatMap((locationId) => [
            { ...holiday(`${y}-01-22`, 'San Vicente Mártir', 'REGIONAL'), scope: 'LOCAL' as const, locationId },
            { ...holiday(addDays(easter, 8), 'San Vicente Ferrer', 'REGIONAL'), scope: 'LOCAL' as const, locationId },
          ]),
        ];
      }),
    });

    // ── Cuadrante: dos semanas pasadas, la actual y la siguiente, publicadas; la otra, en borrador ──
    const monday = addDays(today, -((weekday(today) + 6) % 7));
    const days = (from: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(from, i)).filter(isWorkday);
    const shiftInputs = (dates: string[]) =>
      (Object.entries(PLAN) as [Person, NonNullable<(typeof PLAN)[Person]>][]).flatMap(([person, p]) =>
        dates.map((d) => ({
          userId: users[person].id,
          start: at(d, p.start).toISOString(),
          end: at(d, p.end).toISOString(),
          breakMinutes: p.breakMinutes,
          locationId: sites[p.site].id,
        })),
      );
    await this.shifts.create(users.manager.id, ws.manager, shiftInputs(days(addDays(monday, -14), 28)));
    await this.shifts.publish(users.manager.id, ws.manager, at(addDays(monday, -14), '00:00'), at(addDays(monday, 14), '00:00'));
    await this.shifts.create(users.manager.id, ws.manager, shiftInputs(days(addDays(monday, 14), 7)));
    const shiftRows = await this.prisma.shift.findMany({ where: { organizationId: org.id }, select: { id: true, userId: true, date: true } });
    const shiftOf = (userId: string, date: string): string | null =>
      shiftRows.find((s) => s.userId === userId && s.date.toISOString().slice(0, 10) === date)?.id ?? null;

    // ── Ausencias: vacaciones aprobadas, una solicitud que choca con el cuadrante y un día propio ──
    const nextMonday = addDays(monday, 14);
    const anaHoliday = await this.absences.create(users.ana.id, ws.ana, { type: 'VACATION', startDate: nextMonday, endDate: addDays(nextMonday, 4), halfDay: false, reason: 'Vacaciones de invierno' });
    await this.absences.review(users.manager.id, ws.manager, anaHoliday.id, { decision: 'APPROVE' });
    await this.absences.create(users.luis.id, ws.luis, { type: 'VACATION', startDate: addDays(monday, 10), endDate: addDays(monday, 11), halfDay: false, reason: 'Boda de mi hermana' });
    await this.absences.create(users.manager.id, ws.manager, { type: 'PERSONAL', startDate: addDays(monday, -21), endDate: addDays(monday, -21), halfDay: false, reason: 'Gestiones personales' });

    // ── Fichajes de los últimos días laborables ───────────────────────────
    const past = Array.from({ length: 20 }, (_, i) => addDays(today, -(i + 1)))
      .filter(isWorkday)
      .slice(0, 12)
      .reverse();
    // Ana olvidó fichar un día (lo declara a mano) y Luis tiene la salida de ayer en corrección.
    const anaForgot = past[past.length - 5]!;
    let luisLastWorkday: { id: string; date: string } | null = null;
    const luisEnds = new Map<string, Date>();
    let luisYesterdayStart: Date | null = null;

    for (const [di, date] of past.entries()) {
      for (const person of ['manager', 'luis', 'ana'] as const) {
        if (person === 'ana' && date === anaForgot) continue;
        const p = PLAN[person]!;
        const site = sites[p.site];
        const late = person === 'ana' && di === past.length - 3 ? 23 : 0;
        const start = at(date, p.start, Math.round(rnd() * 14) - 8 + late);
        const breakStart = at(date, person === 'manager' ? '13:30' : '11:00', Math.round(rnd() * 20));
        const breakEnd = new Date(breakStart.getTime() + (p.breakMinutes + Math.round(rnd() * 6)) * 60_000);
        // Anteayer Luis alargó la jornada por una urgencia en la obra: ayer descansó menos de 12 h.
        const urgent = person === 'luis' && di === past.length - 2;
        const end = urgent ? at(date, '19:30', Math.round(rnd() * 6)) : at(date, p.end, Math.round(rnd() * 35) - 3 + (person === 'luis' && di % 4 === 1 ? 70 : 0));
        if (person === 'luis') luisEnds.set(date, end);
        if (person === 'luis' && di === past.length - 1) luisYesterdayStart = start;
        const lateBy = Math.floor((start.getTime() - at(date, p.start).getTime()) / 60_000);
        // Ana ficha en la reforma de Colón con el QR del cartel algunos días.
        const presenceMethod = person === 'ana' && di % 4 === 2 ? ('QR' as const) : ('GPS' as const);
        const outside = person === 'luis' && di === 2;
        const offline = person === 'ana' && di === 6;
        const photo = person !== 'manager' && di % 3 === 0;
        const workdayId = randomUUID();
        const startPos = outside ? near(site.lat, site.lng, 260, 190) : near(site.lat, site.lng, rnd() * 60 - 30, rnd() * 60 - 30);
        const endPos = near(site.lat, site.lng, rnd() * 60 - 30, rnd() * 60 - 30);

        const firstId = randomUUID();
        const lastId = randomUUID();
        let startPhotoKey: string | null = null;
        let endPhotoKey: string | null = null;
        if (photo) {
          const month = date.slice(0, 7).replace('-', '/');
          startPhotoKey = `time/${users[person].id}/${month}/${firstId}-start.jpg`;
          endPhotoKey = `time/${users[person].id}/${month}/${lastId}-end.jpg`;
          await this.storage.put(startPhotoKey, jpeg(SITE_A), 'image/jpeg');
          await this.storage.put(endPhotoKey, jpeg(SITE_B), 'image/jpeg');
        }
        const common = {
          organizationId: org.id,
          userId: users[person].id,
          workdayId,
          shiftId: shiftOf(users[person].id, date),
          locationId: site.id,
          origin: 'REALTIME' as const,
          approvalStatus: 'APPROVED' as const,
          syncedOffline: offline,
        };
        await this.prisma.timeEntry.createMany({
          data: [
            {
              ...common,
              id: firstId,
              entryType: 'WORK',
              startTime: start,
              endTime: breakStart,
              clientStartTime: offline ? new Date(start.getTime() + 2_000) : start,
              clientEndTime: breakStart,
              startLat: startPos.lat,
              startLng: startPos.lng,
              startAccuracy: 8 + Math.round(rnd() * 20),
              startAddress: site.address,
              isWithinGeofence: !outside,
              geofenceDistanceMeters: outside ? 190 : null,
              startPhotoKey,
              presenceMethod,
              lateMinutes: lateBy > DEFAULT_ORGANIZATION_SETTINGS.lateToleranceMinutes ? lateBy : null,
            },
            { ...common, entryType: 'BREAK', breakKind: 'MEAL', startTime: breakStart, endTime: breakEnd, clientStartTime: breakStart, clientEndTime: breakEnd },
            {
              ...common,
              id: lastId,
              entryType: 'WORK',
              startTime: breakEnd,
              endTime: end,
              clientStartTime: breakEnd,
              clientEndTime: end,
              endLat: endPos.lat,
              endLng: endPos.lng,
              endAccuracy: 8 + Math.round(rnd() * 20),
              endAddress: site.address,
              isWithinGeofence: true,
              endPhotoKey,
              presenceMethod,
            },
          ],
        });
        if (person === 'luis') luisLastWorkday = { id: workdayId, date };
      }
    }

    // ── Notas de relevo: Luis las verá al iniciar su jornada ──
    const lastEvening = new Date(Date.now() - 15 * 3_600_000);
    await this.prisma.handoverNote.createMany({
      data: [
        {
          organizationId: org.id,
          authorId: users.ana.id,
          recipientId: null,
          body: 'He dejado el andamio de la fachada norte sin el último tramo de barandilla: no subáis hasta montarlo. Las llaves del almacén están en la caseta.',
          createdAt: lastEvening,
        },
        {
          organizationId: org.id,
          authorId: users.manager.id,
          recipientId: users.luis.id,
          body: 'Luis, mañana a primera hora llega el camión del hormigón. Recíbelo tú y apunta los albaranes en gastos.',
          createdAt: new Date(lastEvening.getTime() + 40 * 60_000),
        },
      ],
    });

    // ── Alertas de jornada: una abierta (descanso corto de Luis) y otra ya resuelta ──
    const beforeYesterday = past[past.length - 2]!;
    const luisLongEnd = luisEnds.get(beforeYesterday);
    if (luisLongEnd && luisYesterdayStart) {
      const rest = Math.round(((luisYesterdayStart.getTime() - luisLongEnd.getTime()) / 3_600_000) * 10) / 10;
      await this.prisma.alert.create({
        data: { organizationId: org.id, userId: users.luis.id, kind: 'SHORT_REST', date: new Date(`${past[past.length - 1]}T00:00:00Z`), data: { hours: rest }, createdAt: luisYesterdayStart },
      });
      await this.prisma.notification.createMany({
        data: [users.manager.id, users.admin.id].map((userId) => ({
          userId,
          organizationId: org.id,
          type: 'ALERT' as const,
          payload: { link: '/alerts', alertKind: 'SHORT_REST', name: users.luis.fullName, hours: rest },
          pushedAt: luisYesterdayStart,
          createdAt: luisYesterdayStart!,
        })),
      });
    }
    await this.prisma.alert.create({
      data: {
        organizationId: org.id,
        userId: users.ana.id,
        kind: 'MISSED_CLOCK_IN',
        date: new Date(`${anaForgot}T00:00:00Z`),
        data: { minutes: 30, plannedStart: at(anaForgot, PLAN.ana!.start).toISOString(), escalated: true },
        createdAt: at(anaForgot, '08:30'),
        resolvedAt: at(anaForgot, '17:05'),
        resolvedById: users.manager.id,
      },
    });

    // ── Correcciones y jornadas manuales pendientes de validar ───────────
    await this.corrections.submit(
      users.ana.id,
      ws.ana,
      {
        start: at(anaForgot, '08:02').toISOString(),
        end: at(anaForgot, '16:10').toISOString(),
        breaks: [{ kind: 'MEAL', start: at(anaForgot, '12:00').toISOString(), end: at(anaForgot, '12:30').toISOString() }],
        locationId: sites.colon.id,
        reason: 'Me quedé sin batería en el móvil y no pude fichar.',
      },
      DEMO_META,
    );
    if (luisLastWorkday) {
      const d = luisLastWorkday.date;
      await this.corrections.submitCorrection(
        users.luis.id,
        ws.luis,
        luisLastWorkday.id,
        {
          start: at(d, '07:00').toISOString(),
          end: at(d, '16:30').toISOString(),
          breaks: [{ kind: 'MEAL', start: at(d, '11:00').toISOString(), end: at(d, '11:30').toISOString() }],
          locationId: sites.puerto.id,
          reason: 'Me quedé a terminar el encofrado y fiché la salida antes de tiempo.',
        },
        DEMO_META,
      );
    }
    const saturday = addDays(monday, -2);
    const weekend = await this.corrections.submit(
      users.luis.id,
      ws.luis,
      { start: at(saturday, '08:00').toISOString(), end: at(saturday, '12:00').toISOString(), breaks: [], locationId: sites.nave.id, reason: 'Trabajé el sábado por la mañana descargando material en la nave.' },
      DEMO_META,
    );
    await this.corrections.review(users.manager.id, ws.manager, weekend.id, { decision: 'REJECT', reason: 'No consta ninguna orden de trabajo para ese sábado. Hablamos el lunes.' }, DEMO_META);

    // ── Gastos en todos los estados ───────────────────────────────────────
    const day = (n: number): string => past[past.length - n]!;
    const expense = async (person: Person, dto: Omit<ExpenseInput, 'paymentMethod'> & { paymentMethod?: ExpenseInput['paymentMethod'] }, receipt?: string) =>
      this.expenses.create(users[person].id, ws[person], { paymentMethod: 'EMPLOYEE_PAID', ...dto }, receipt ? { buffer: jpeg(receipt) } : undefined);
    const meal = await expense('luis', { category: 'MEAL', amount: 12.5, taxAmount: 1.14, date: day(9), merchantName: 'Bar La Obra', locationId: sites.puerto.id }, RECEIPT_MEAL);
    const parking = await expense('luis', { category: 'TOLL', amount: 6.2, date: day(8), merchantName: 'Parking Puerto', notes: 'Aparcamiento junto a la obra' });
    await expense('luis', { category: 'FUEL', amount: 58.4, taxAmount: 10.14, date: day(2), merchantName: 'Estación de Servicio Sur', paymentMethod: 'COMPANY_CARD' }, RECEIPT_FUEL);
    await expense('luis', { category: 'MILEAGE', distanceKm: 46, date: day(1), notes: 'Ida y vuelta a la nave de Fuente del Jarro', locationId: sites.nave.id });
    const tools = await expense('luis', { category: 'MATERIAL', amount: 23.9, taxAmount: 4.15, date: day(5), merchantName: 'Ferretería Levante' }, RECEIPT_HARDWARE);
    const anaMeal = await expense('ana', { category: 'MEAL', amount: 11, date: day(7), merchantName: 'Bar La Obra', locationId: sites.colon.id }, RECEIPT_MEAL);
    await expense('ana', { category: 'LODGING', amount: 68, date: day(3), merchantName: 'Hotel Centro Madrid', notes: 'Curso de prevención de riesgos en Madrid' });

    const review = (id: string, decision: 'APPROVE' | 'REJECT', reason?: string) =>
      this.expenses.review(users.manager.id, ws.manager, id, { decision, reason });
    await review(meal.id, 'APPROVE');
    await review(parking.id, 'APPROVE');
    await review(anaMeal.id, 'APPROVE');
    await review(tools.id, 'REJECT', 'Ese material se pide a la cuenta del proveedor; no se adelanta.');
    // Lo de Luis se le ha pagado ya; lo de Ana está aprobado y pendiente de pago.
    await this.expenses.reimburse(users.manager.id, ws.manager, users.luis.id, day(12), day(1));

    // ── Documentos: contrato por firmar, plan de prevención, nómina y un justificante ──
    const contract = await textPdf('Contrato de trabajo', `${DEMO_ORGANIZATION.name} · Ana Vidal Torres`, [
      'REUNIDOS: de una parte, la empresa, y de otra, la persona trabajadora, ambas con capacidad legal para obligarse.',
      'PRIMERA. La persona trabajadora prestará servicios como Encargada de reformas, con una jornada de 40 horas semanales distribuidas de lunes a viernes.',
      'SEGUNDA. El registro diario de jornada se llevará mediante la aplicación HR-Core, a la que la persona trabajadora tendrá acceso en todo momento.',
      'TERCERA. Las partes se someten a lo dispuesto en el convenio colectivo del sector de la construcción de la provincia.',
      'Documento de ejemplo generado para la demostración de HR-Core.',
    ]);
    await this.documents.send(users.manager.id, ws.manager, { title: 'Contrato de trabajo', category: 'CONTRACT', requiresSignature: true, recipients: [users.ana.id] }, { buffer: contract, originalName: 'contrato-ana-vidal.pdf' });

    const safety = await textPdf('Plan de prevención de riesgos laborales 2026', DEMO_ORGANIZATION.name, [
      'Este plan recoge la evaluación de riesgos de las obras y las medidas preventivas que la empresa aplica en cada una de ellas.',
      'Es obligatorio el uso de casco, calzado de seguridad y chaleco reflectante en todas las obras. En trabajos en altura, además, arnés anclado a línea de vida.',
      'Cualquier incidente o situación de riesgo se comunicará de inmediato al jefe de obra.',
      'Con tu firma confirmas que has recibido y leído este plan.',
    ]);
    // Con plazo: en unos días empiezan los recordatorios a quien no lo haya firmado.
    const sent = await this.documents.send(
      users.manager.id,
      ws.manager,
      { title: 'Plan de prevención de riesgos 2026', category: 'SAFETY', requiresSignature: true, recipients: 'ALL', dueDate: addDays(today, 5) },
      { buffer: safety, originalName: 'plan-prevencion-2026.pdf' },
    );
    const luisCopy = sent.find((d) => d.recipient.id === users.luis.id);
    if (luisCopy) {
      await this.documents.sign(
        users.luis.id,
        ws.luis,
        luisCopy.id,
        { signature: `data:image/png;base64,${signaturePng(7).toString('base64')}`, strokes: 3, points: 412 },
        DEMO_META,
      );
    }

    const month = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: TZ }).format(at(addDays(monday, -14), '12:00'));
    for (const person of ['luis', 'ana'] as const) {
      const slip = await payslipPdf({
        company: DEMO_ORGANIZATION.name,
        taxId: DEMO_ORGANIZATION.taxId,
        name: users[person].fullName,
        dni: dni(PROFILE[person].dni),
        month,
        gross: person === 'luis' ? 2140 : 2380,
        net: person === 'luis' ? 1712.4 : 1868.9,
      });
      const [doc] = await this.documents.send(users.admin.id, ws.admin, { title: `Nómina de ${month}`, category: 'PAYROLL', requiresSignature: false, recipients: [users[person].id] }, { buffer: slip, originalName: `nomina-${person}.pdf` });
      if (doc && person === 'luis') await this.documents.acknowledge(users.luis.id, ws.luis, doc.id);
    }

    // Registro de jornada del mes pasado, enviado para firmar (Luis ya lo ha firmado).
    const prevMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    await this.documentJobs.sendTimesheets(users.admin.id, ws.admin, prevMonth);
    const luisSheet = await this.prisma.document.findFirst({ where: { organizationId: org.id, recipientId: users.luis.id, period: prevMonth } });
    if (luisSheet) {
      await this.documents.sign(users.luis.id, ws.luis, luisSheet.id, { signature: `data:image/png;base64,${signaturePng(11).toString('base64')}`, strokes: 2, points: 318 }, DEMO_META);
    }

    const note = await textPdf('Justificante de asistencia a consulta médica', 'Centro de Salud Ruzafa', [
      `Se hace constar que Ana Vidal Torres ha asistido a consulta médica el día ${day(10)} de 09:00 a 10:30.`,
      'Documento de ejemplo generado para la demostración de HR-Core.',
    ]);
    await this.documents.send(users.ana.id, ws.ana, { title: 'Justificante médico', category: 'MEDICAL_LEAVE', requiresSignature: false, recipients: 'MANAGERS' }, { buffer: note, originalName: 'justificante-medico.pdf' });

    // Los avisos de lo ya resuelto se dan por leídos: la campana muestra solo lo que pide hacer algo.
    await this.prisma.notification.updateMany({
      where: { organizationId: org.id, type: { notIn: ['TIME_ENTRY_PENDING', 'EXPENSE_PENDING', 'DOCUMENT_RECEIVED', 'ALERT'] } },
      data: { readAt: now },
    });
  }
}
