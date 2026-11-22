import { zodResolver } from '@hookform/resolvers/zod';
import {
  HOLIDAY_SCOPES,
  PAYROLL_COLUMNS,
  type PayrollColumn,
  type HolidayDto,
  type HolidayScopeId,
  type KioskDeviceDto,
  type KioskPairingDto,
  type LocationDto,
  type OrganizationDto,
  type OrganizationSettingsInput,
  organizationSettingsSchema,
  SPANISH_REGIONS,
} from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarPlus, ChevronLeft, ChevronRight, CloudDownload, ImageUp, KeyRound, Plus, Tablet, Trash2 } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { api, apiBlob } from '../lib/api';
import { accentTokens } from '../lib/brand';
import { cn } from '../lib/cn';
import { errorMessage, fieldMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';
import { Field } from '../ui/Field';
import { PageHeader } from '../ui/Page';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';
import { selectClass, Switch, textareaClass } from '../ui/Switch';
import { formatRange } from './Absences';

const ZONES = [
  'Europe/Madrid',
  'Atlantic/Canary',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/Mexico_City',
  'America/Bogota',
  'America/Argentina/Buenos_Aires',
];
const RETENTION = [3, 6, 12, 24, 48, 0];

function Section({ id, title, desc, children }: { id: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <SectionTitle id={id} className="mb-2.5">
        {title}
      </SectionTitle>
      <Card className="space-y-4 p-4 sm:p-5">
        {desc && <p className="text-sm text-fg-muted">{desc}</p>}
        {children}
      </Card>
    </section>
  );
}

/** Lo que edita el formulario: los ajustes, sin lo que no se cambia aquí (el logotipo va aparte). */
const formValues = (d: OrganizationDto): OrganizationSettingsInput => {
  const { id: _id, currency: _currency, hasLogo: _logo, ...rest } = d;
  return { ...rest, taxId: d.taxId ?? '' };
};

/** Color de la marca con vista previa de cómo quedará (ya ajustado al contraste AA). */
function AccentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const color = value || '#0067d6';
  const tokens = accentTokens(color).light;
  return (
    <div className="edge-t space-y-3 pt-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="org-accent" className="mb-1.5 block text-sm font-medium">
            {t('company.accent')}
          </label>
          <input
            id="org-accent"
            type="color"
            value={color}
            onChange={(e) => onChange(e.target.value)}
            className="edge h-12 w-20 cursor-pointer rounded-control bg-surface p-1"
          />
        </div>
        {value && (
          <Button variant="ghost" size="sm" onClick={() => onChange('')}>
            {t('company.accentReset')}
          </Button>
        )}
      </div>
      <p className="text-sm text-fg-muted">{t('company.accentHint')}</p>
      <div className="edge flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2/50 p-3" aria-label={t('company.accentPreview')}>
        <span className="text-sm text-fg-muted">{t('company.accentPreview')}</span>
        <span className="rounded-control px-4 py-2 text-sm font-semibold" style={{ background: tokens['--accent'], color: tokens['--accent-fg'] }}>
          {t('company.accentSample')}
        </span>
        <span className="text-sm font-semibold underline" style={{ color: tokens['--accent-text'] }}>
          {t('company.accentLink')}
        </span>
      </div>
    </div>
  );
}

/** Columnas del archivo para la gestoría: cuáles van y en qué orden. */
function PayrollColumns({ value, onChange }: { value: PayrollColumn[]; onChange: (v: PayrollColumn[]) => void }) {
  const { t } = useTranslation();
  const ordered: PayrollColumn[] = [...value, ...PAYROLL_COLUMNS.filter((c) => !value.includes(c))];
  const move = (c: PayrollColumn, dir: -1 | 1): void => {
    const i = value.indexOf(c);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <ul className="edge divide-y divide-border rounded-2xl">
      {ordered.map((c) => {
        const on = value.includes(c);
        const name = t(`company.payrollCol.${c}`);
        return (
          <li key={c} className={cn('flex items-center gap-2 px-3 py-2', !on && 'opacity-70')}>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1">
              <input
                type="checkbox"
                checked={on}
                disabled={on && value.length === 1}
                onChange={(e) => onChange(e.target.checked ? [...value, c] : value.filter((x) => x !== c))}
                className="size-5 accent-(--accent)"
              />
              <span className="truncate text-sm font-medium">{name}</span>
            </label>
            {on && (
              <span className="flex">
                <Button variant="ghost" size="sm" aria-label={t('company.moveUp', { name })} disabled={value.indexOf(c) === 0} onClick={() => move(c, -1)} icon={<ArrowUp className="size-4" />} />
                <Button variant="ghost" size="sm" aria-label={t('company.moveDown', { name })} disabled={value.indexOf(c) === value.length - 1} onClick={() => move(c, 1)} icon={<ArrowDown className="size-4" />} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Logotipo de la empresa: se sube y se quita al momento (no espera al botón de guardar). */
function LogoManager({ hasLogo }: { hasLogo: boolean }) {
  const { t } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const reload = useSession((s) => s.reload);
  const input = useRef<HTMLInputElement>(null);
  const preview = useQuery({
    queryKey: ['org-logo', workspaceId],
    queryFn: async () => URL.createObjectURL(await apiBlob('/organization/logo')),
    enabled: hasLogo,
    staleTime: 10 * 60_000,
  });
  const done = async (saved: OrganizationDto, message: string): Promise<void> => {
    queryClient.setQueryData(['organization', workspaceId], saved);
    await queryClient.invalidateQueries({ queryKey: ['org-logo'] });
    await reload();
    toast.success(message);
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return api<OrganizationDto>('/organization/logo', { method: 'POST', body: form });
    },
    onSuccess: (saved) => done(saved, t('company.logoSaved')),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const remove = useMutation({
    mutationFn: () => api<OrganizationDto>('/organization/logo', { method: 'DELETE' }),
    onSuccess: (saved) => done(saved, t('company.logoRemoved')),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const pick = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) upload.mutate(f);
  };
  return (
    <Section id="company-logo" title={t('company.logo')} desc={t('company.logoHint')}>
      <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={pick} tabIndex={-1} aria-hidden="true" />
      {hasLogo && preview.data && (
        <div className="edge flex justify-center rounded-2xl bg-surface-2/50 p-4">
          <img src={preview.data} alt={t('company.logo')} className="max-h-16 max-w-full object-contain" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={upload.isPending} onClick={() => input.current?.click()} icon={<ImageUp className="size-4" />}>
          {hasLogo ? t('company.logoChange') : t('company.logoUpload')}
        </Button>
        {hasLogo && (
          <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()} icon={<Trash2 className="size-4" />}>
            {t('company.logoRemove')}
          </Button>
        )}
      </div>
    </Section>
  );
}

/** Ajustes de la empresa: solo los ve y los cambia el administrador. */
export function Company() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const workspaceId = useSession((s) => s.workspaceId);
  const reload = useSession((s) => s.reload);
  const isAdmin = ws.kind === 'organization' && ws.role === 'ADMIN';
  const { data } = useQuery({
    queryKey: ['organization', workspaceId],
    queryFn: () => api<OrganizationDto>('/organization'),
    enabled: isAdmin,
  });
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<OrganizationSettingsInput>({ resolver: zodResolver(organizationSettingsSchema) });

  useEffect(() => {
    if (data) reset(formValues(data));
  }, [data, reset]);

  const save = useMutation({
    mutationFn: (dto: OrganizationSettingsInput) => api<OrganizationDto>('/organization', { method: 'PATCH', body: dto }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['organization', workspaceId], saved);
      reset(formValues(saved));
      // Tarifa, tramo nocturno y zona horaria cambian cálculos que otras pantallas ya tenían cargados.
      for (const key of ['expenses', 'hours', 'dashboard']) void queryClient.invalidateQueries({ queryKey: [key] });
      await reload();
      toast.success(t('settings.companySaved'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  if (!isAdmin) return <Navigate to="/settings" replace />;
  if (!data) {
    return (
      <div className="flex justify-center py-24 text-fg-subtle">
        <Spinner className="size-7" />
      </div>
    );
  }
  const zones = ZONES.includes(data.timezone) ? ZONES : [data.timezone, ...ZONES];
  const quiet = watch('quietHours') ?? data.quietHours;
  const monthly = watch('monthlyTimesheet') ?? data.monthlyTimesheet;

  return (
    <div className="animate-page space-y-7 pb-16">
      <form onSubmit={handleSubmit((dto) => save.mutate(dto))} className="space-y-7" noValidate>
        <PageHeader title={t('company.title')} subtitle={ws.kind === 'organization' ? ws.name : undefined} />

        <Section id="company-general" title={t('company.general')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.companyName')} error={fieldMessage(t, errors.name)} {...register('name')} />
            <Field label={t('workspace.taxId')} autoCapitalize="characters" error={fieldMessage(t, errors.taxId)} {...register('taxId')} />
          </div>
        </Section>

        <Section id="company-brand" title={t('company.brand')} desc={t('company.brandDesc')}>
          <Field label={t('company.brandName')} hint={t('company.brandNameHint')} maxLength={80} error={fieldMessage(t, errors.brandName)} {...register('brandName')} />
          <AccentPicker value={watch('accentColor') ?? ''} onChange={(v) => setValue('accentColor', v, { shouldDirty: true })} />
        </Section>

        <Section id="company-time" title={t('company.time')}>
          <div>
            <label htmlFor="org-tz" className="mb-1.5 block text-sm font-medium">
              {t('settings.timezone')}
            </label>
            <select id="org-tz" className={selectClass} {...register('timezone')}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-sm text-fg-muted">{t('settings.timezoneHint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('settings.nightStart')} type="time" error={fieldMessage(t, errors.nightStart)} {...register('nightStart')} />
            <Field label={t('settings.nightEnd')} type="time" error={fieldMessage(t, errors.nightEnd)} {...register('nightEnd')} />
          </div>
          <Field
            label={t('settings.geofenceDefault')}
            type="number"
            step="25"
            inputMode="numeric"
            error={fieldMessage(t, errors.defaultGeofenceRadiusMeters)}
            {...register('defaultGeofenceRadiusMeters', { valueAsNumber: true })}
          />
          <div className="edge-t pt-4">
            <Switch
              checked={watch('allowEmployeeManualEntries') ?? true}
              onChange={(v) => setValue('allowEmployeeManualEntries', v, { shouldDirty: true })}
              label={t('settings.allowManual')}
              hint={t('settings.allowManualHint')}
            />
          </div>
          <div className="edge-t pt-4">
            <Switch
              checked={watch('requirePhotoOnClock') ?? false}
              onChange={(v) => setValue('requirePhotoOnClock', v, { shouldDirty: true })}
              label={t('company.requirePhoto')}
              hint={t('company.requirePhotoHint')}
            />
          </div>
          <div className="edge-t pt-4">
            <Field
              label={t('company.lateTolerance')}
              type="number"
              min={0}
              max={120}
              inputMode="numeric"
              hint={t('company.lateToleranceHint')}
              error={fieldMessage(t, errors.lateToleranceMinutes)}
              {...register('lateToleranceMinutes', { valueAsNumber: true })}
            />
          </div>
        </Section>

        <Section id="company-alerts" title={t('company.alerts')} desc={t('company.alertsDesc')}>
          <Switch
            checked={watch('alertsEnabled') ?? true}
            onChange={(v) => setValue('alertsEnabled', v, { shouldDirty: true })}
            label={t('company.alertsEnabled')}
            hint={t('company.alertsEnabledHint')}
          />
          {(watch('alertsEnabled') ?? true) && (
            <div className="edge-t grid gap-4 pt-4 sm:grid-cols-2">
              <Field
                label={t('company.missedClockIn')}
                type="number"
                min={5}
                max={240}
                inputMode="numeric"
                error={fieldMessage(t, errors.missedClockInMinutes)}
                {...register('missedClockInMinutes', { valueAsNumber: true })}
              />
              <Field
                label={t('company.maxOpenHours')}
                type="number"
                min={4}
                max={24}
                inputMode="numeric"
                error={fieldMessage(t, errors.maxOpenHours)}
                {...register('maxOpenHours', { valueAsNumber: true })}
              />
              <div className="sm:col-span-2">
                <Field
                  label={t('company.overtimeLimit')}
                  type="number"
                  min={0}
                  max={1000}
                  inputMode="numeric"
                  hint={t('company.overtimeLimitHint')}
                  error={fieldMessage(t, errors.overtimeYearLimit)}
                  {...register('overtimeYearLimit', { valueAsNumber: true })}
                />
              </div>
            </div>
          )}
        </Section>

        <Section id="company-monthly" title={t('company.monthly')} desc={t('company.monthlyDesc')}>
          <Switch
            checked={monthly.enabled}
            onChange={(v) => setValue('monthlyTimesheet', { ...monthly, enabled: v }, { shouldDirty: true })}
            label={t('company.monthlyEnabled')}
          />
          {monthly.enabled && (
            <div className="edge-t space-y-4 pt-4">
              <div>
                <label htmlFor="org-monthly-day" className="mb-1.5 block text-sm font-medium">
                  {t('company.monthlyDay')}
                </label>
                <select
                  id="org-monthly-day"
                  className={selectClass}
                  value={monthly.day}
                  onChange={(e) => setValue('monthlyTimesheet', { ...monthly, day: Number(e.target.value) }, { shouldDirty: true })}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <Switch
                checked={monthly.requireSignature}
                onChange={(v) => setValue('monthlyTimesheet', { ...monthly, requireSignature: v }, { shouldDirty: true })}
                label={t('company.monthlySignature')}
                hint={t('company.monthlySignatureHint')}
              />
            </div>
          )}
        </Section>

        <Section id="company-payroll" title={t('company.payroll')} desc={t('company.payrollDesc')}>
          <PayrollColumns value={watch('payrollColumns') ?? data.payrollColumns} onChange={(v) => setValue('payrollColumns', v, { shouldDirty: true })} />
          <div className="edge-t pt-4">
            <Field
              label={t('company.surcharge')}
              type="number"
              min={0}
              max={200}
              inputMode="numeric"
              hint={t('company.surchargeHint')}
              error={fieldMessage(t, errors.overtimeSurchargePct)}
              {...register('overtimeSurchargePct', { valueAsNumber: true })}
            />
          </div>
        </Section>

        <Section id="company-expenses" title={t('company.expenses')}>
          <Field
            label={t('settings.mileageRate', { currency: data.currency })}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            error={fieldMessage(t, errors.mileageRatePerKm)}
            {...register('mileageRatePerKm', { valueAsNumber: true })}
          />
        </Section>

        <Section id="company-privacy" title={t('company.privacy')} desc={t('company.privacyDesc')}>
          <div>
            <label htmlFor="org-retention" className="mb-1.5 block text-sm font-medium">
              {t('company.photoRetention')}
            </label>
            <select id="org-retention" className={selectClass} {...register('photoRetentionMonths', { valueAsNumber: true })}>
              {RETENTION.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? t('company.retentionNever') : t('company.retentionMonths', { count: m })}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-sm text-fg-muted">{t('company.photoRetentionHint')}</p>
          </div>

          <div className="edge-t space-y-4 pt-4">
            <Switch
              checked={quiet.enabled}
              onChange={(v) => setValue('quietHours', { ...quiet, enabled: v }, { shouldDirty: true })}
              label={t('company.quietHours')}
              hint={t('company.quietHoursHint')}
            />
            {quiet.enabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label={t('company.quietFrom')}
                    type="time"
                    error={fieldMessage(t, errors.quietHours?.start)}
                    {...register('quietHours.start')}
                  />
                  <Field
                    label={t('company.quietTo')}
                    type="time"
                    error={fieldMessage(t, errors.quietHours?.end)}
                    {...register('quietHours.end')}
                  />
                </div>
                <Switch
                  checked={quiet.weekends}
                  onChange={(v) => setValue('quietHours', { ...quiet, weekends: v }, { shouldDirty: true })}
                  label={t('company.quietWeekends')}
                />
              </>
            )}
          </div>

          <div className="edge-t pt-4">
            <label htmlFor="org-geo-text" className="mb-1.5 block text-sm font-medium">
              {t('company.geoNoticeText')}
            </label>
            <textarea
              id="org-geo-text"
              className={textareaClass}
              maxLength={1500}
              placeholder={t('company.geoNoticePlaceholder')}
              {...register('geoNoticeText')}
            />
            <p className="mt-1.5 text-sm text-fg-muted">{t('company.geoNoticeHint')}</p>
          </div>
        </Section>

        <Section id="company-calendar" title={t('company.calendar')} desc={t('company.calendarDesc')}>
          <div>
            <label htmlFor="org-region" className="mb-1.5 block text-sm font-medium">
              {t('company.region')}
            </label>
            <select id="org-region" className={selectClass} {...register('region')}>
              <option value="">{t('company.regionNone')}</option>
              {SPANISH_REGIONS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-sm text-fg-muted">{t('company.regionHint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('company.vacationDays')}
              type="number"
              min={0}
              max={60}
              inputMode="numeric"
              error={fieldMessage(t, errors.vacationDays)}
              {...register('vacationDays', { valueAsNumber: true })}
            />
            <div>
              <label htmlFor="org-vacation-unit" className="mb-1.5 block text-sm font-medium">
                {t('company.vacationUnit')}
              </label>
              <select id="org-vacation-unit" className={selectClass} {...register('vacationUnit')}>
                <option value="WORKING">{t('company.unitWorking')}</option>
                <option value="NATURAL">{t('company.unitNatural')}</option>
              </select>
            </div>
          </div>
        </Section>

        {/* Barra de guardar: aparece al cambiar algo y se queda a la vista mientras se baja por la página. */}
        {isDirty && (
          <div className="fixed inset-x-0 bottom-24 z-30 px-4 lg:bottom-6 lg:pl-[272px]">
            <div className="edge mx-auto flex max-w-3xl items-center gap-3 rounded-2xl bg-surface p-3 shadow-lg">
              <p className="min-w-0 flex-1 truncate pl-1 text-sm font-medium">{t('company.unsaved')}</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => reset(formValues(data))}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" loading={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </form>
      <LogoManager hasLogo={data.hasLogo} />
      <HolidaysManager />
      <KiosksManager />
    </div>
  );
}

/** Festivos del año: importar los oficiales (nacionales y de la comunidad) y añadir los locales. */
function HolidaysManager() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<HolidayScopeId>('LOCAL');
  const [locationId, setLocationId] = useState('');
  const list = useQuery({ queryKey: ['holidays', workspaceId, year], queryFn: () => api<HolidayDto[]>(`/holidays?year=${year}`) });
  const locations = useQuery({ queryKey: ['locations', workspaceId], queryFn: () => api<LocationDto[]>('/locations') });
  const refresh = (): void => {
    for (const key of ['holidays', 'absences', 'hours']) void queryClient.invalidateQueries({ queryKey: [key] });
  };
  const importOfficial = useMutation({
    mutationFn: () => api<{ imported: number; skipped: number }>('/holidays/import', { method: 'POST', body: { year } }),
    onSuccess: (r) => {
      refresh();
      toast.success(t('company.holidaysImported', { count: r.imported }));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const add = useMutation({
    mutationFn: () =>
      api<HolidayDto>('/holidays', {
        method: 'POST',
        body: { date, name, scope, locationId: scope === 'LOCAL' && locationId ? locationId : null },
      }),
    onSuccess: () => {
      refresh();
      setDate('');
      setName('');
      toast.success(t('company.holidayAdded'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (date && name.trim().length >= 2) add.mutate();
  };

  return (
    <Section id="company-holidays" title={t('company.holidays')} desc={t('company.holidaysDesc')}>
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setYear(year - 1)}
          aria-label={t('company.prevYear')}
          icon={<ChevronLeft className="size-5" />}
        />
        <p className="font-semibold tabular-nums">{year}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setYear(year + 1)}
          aria-label={t('company.nextYear')}
          icon={<ChevronRight className="size-5" />}
        />
      </div>
      <Button
        variant="secondary"
        block
        loading={importOfficial.isPending}
        onClick={() => importOfficial.mutate()}
        icon={<CloudDownload className="size-4" />}
      >
        {t('company.importHolidays', { year })}
      </Button>
      {list.isPending ? (
        <div className="flex justify-center py-6 text-fg-subtle">
          <Spinner />
        </div>
      ) : (list.data ?? []).length === 0 ? (
        <p className="py-2 text-center text-sm text-fg-muted">{t('company.noHolidays')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {(list.data ?? []).map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-2.5">
              <span className="w-24 shrink-0 text-sm text-fg-muted tabular-nums first-letter:uppercase">
                {formatRange(h.date, h.date, lang)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{h.name}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {t(`company.scope.${h.scope}`)}
                  {h.location && ` · ${h.location.name}`}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove.mutate(h.id)}
                aria-label={`${t('common.delete')}: ${h.name}`}
                icon={<Trash2 className="size-4" />}
              />
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="edge-t space-y-3 pt-4" noValidate>
        <p className="text-sm font-medium">{t('company.addHoliday')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('company.holidayDate')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <div>
            <label htmlFor="holiday-scope" className="mb-1.5 block text-sm font-medium">
              {t('company.holidayScope')}
            </label>
            <select id="holiday-scope" className={selectClass} value={scope} onChange={(e) => setScope(e.target.value as HolidayScopeId)}>
              {HOLIDAY_SCOPES.map((x) => (
                <option key={x} value={x}>
                  {t(`company.scope.${x}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Field label={t('company.holidayName')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        {scope === 'LOCAL' && (
          <div>
            <label htmlFor="holiday-location" className="mb-1.5 block text-sm font-medium">
              {t('company.holidayLocation')}
            </label>
            <select id="holiday-location" className={selectClass} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t('company.holidayAllLocations')}</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button
          type="submit"
          variant="secondary"
          block
          loading={add.isPending}
          disabled={!date || name.trim().length < 2}
          icon={<CalendarPlus className="size-4" />}
        >
          {t('company.addHolidayButton')}
        </Button>
      </form>
    </Section>
  );
}

/** Quioscos de fichaje: tablets compartidas, cada una emparejada con un código de un solo uso. */
function KiosksManager() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [pairing, setPairing] = useState<KioskPairingDto | null>(null);
  const list = useQuery({ queryKey: ['kiosks', workspaceId], queryFn: () => api<KioskDeviceDto[]>('/kiosks') });
  const locations = useQuery({ queryKey: ['locations', workspaceId], queryFn: () => api<LocationDto[]>('/locations') });
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: ['kiosks'] });
  const create = useMutation({
    mutationFn: () => api<KioskPairingDto>('/kiosks', { method: 'POST', body: { name: name.trim(), locationId: locationId || null } }),
    onSuccess: (p) => {
      refresh();
      setName('');
      setPairing(p);
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const newCode = useMutation({
    mutationFn: (id: string) => api<KioskPairingDto>(`/kiosks/${id}/pairing`, { method: 'POST' }),
    onSuccess: (p) => {
      refresh();
      setPairing(p);
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/kiosks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success(t('company.kioskRemoved'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (name.trim().length >= 2) create.mutate();
  };
  const url = `${window.location.origin}${import.meta.env.BASE_URL}kiosk`;
  const seen = (iso: string): string => {
    const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
    const f = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return f.format(minutes, 'minute');
    if (Math.abs(minutes) < 1440) return f.format(Math.round(minutes / 60), 'hour');
    return f.format(Math.round(minutes / 1440), 'day');
  };

  return (
    <Section id="company-kiosks" title={t('company.kiosks')} desc={t('company.kiosksDesc')}>
      {list.isPending ? (
        <div className="flex justify-center py-6 text-fg-subtle">
          <Spinner />
        </div>
      ) : (list.data ?? []).length === 0 ? (
        <p className="py-2 text-center text-sm text-fg-muted">{t('company.noKiosks')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {(list.data ?? []).map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
                <Tablet className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{k.name}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {k.paired ? t('company.kioskSeen', { when: k.lastSeenAt ? seen(k.lastSeenAt) : '—' }) : t('company.kioskWaiting')}
                  {k.location && ` · ${k.location.name}`}
                </span>
              </span>
              <span className="flex gap-1">
                <Button variant="secondary" size="sm" loading={newCode.isPending && newCode.variables === k.id} onClick={() => newCode.mutate(k.id)} icon={<KeyRound className="size-4" />}>
                  {t('company.kioskNewCode')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.confirm(t('company.kioskRemoveConfirm', { name: k.name })) && remove.mutate(k.id)}
                  aria-label={`${t('common.delete')}: ${k.name}`}
                  icon={<Trash2 className="size-4" />}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="edge-t space-y-3 pt-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('company.kioskName')} placeholder={t('company.kioskNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <div>
            <label htmlFor="kiosk-location" className="mb-1.5 block text-sm font-medium">
              {t('company.kioskLocation')}
            </label>
            <select id="kiosk-location" className={selectClass} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">{t('company.kioskNoLocation')}</option>
              {(locations.data ?? [])
                .filter((l) => l.isActive)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <Button type="submit" variant="secondary" block loading={create.isPending} disabled={name.trim().length < 2} icon={<Plus className="size-4" />}>
          {t('company.addKiosk')}
        </Button>
        <p className="text-sm text-fg-muted">{t('company.kioskPeopleHint')}</p>
      </form>

      <Sheet open={!!pairing} onClose={() => setPairing(null)} title={t('company.pairTitle')} description={pairing?.kiosk.name}>
        {pairing && (
          <div className="space-y-4 pb-1">
            <div>
              <p className="text-sm text-fg-muted">{t('company.pairStep1')}</p>
              <p className="mt-1 rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm break-all select-all">{url}</p>
            </div>
            <div>
              <p className="text-sm text-fg-muted">{t('company.pairStep2')}</p>
              <p className="mt-1 text-center font-mono text-4xl font-bold tracking-[0.3em] select-all" aria-live="polite">
                {pairing.code}
              </p>
            </div>
            <p className="text-center text-sm text-fg-muted">
              {t('company.pairExpires', { time: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(pairing.expiresAt)) })}
            </p>
            <Button block onClick={() => setPairing(null)}>
              {t('common.close')}
            </Button>
          </div>
        )}
      </Sheet>
    </Section>
  );
}
