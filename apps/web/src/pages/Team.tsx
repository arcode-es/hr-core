import { zodResolver } from '@hookform/resolvers/zod';
import { CreateInvitationInput, createInvitationSchema, InvitationDto, MemberDto, Role, UpdateMemberInput } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookOpen, ChevronRight, Copy, CreditCard, FileSpreadsheet, KeyRound, Mail, MailCheck, MailPlus, Share2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { api, apiDownload } from '../lib/api';
import { appUrl } from '../lib/url';
import { cn } from '../lib/cn';
import { errorMessage, fieldMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';
import { Field } from '../ui/Field';
import { EmptyState, PageHeader } from '../ui/Page';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';
import { selectClass } from '../ui/Switch';
import { DepartmentsSection, ImportSheet, InvitationsSection, useDepartments } from './TeamExtra';

const ROLES: Role[] = ['EMPLOYEE', 'MANAGER', 'ADMIN', 'INSPECTOR'];
const roleTone = { ADMIN: 'accent', MANAGER: 'success', EMPLOYEE: 'neutral', INSPECTOR: 'warning' } as const;

/** Lista de roles con su explicación: elegir sin tener que adivinar qué permite cada uno. */
function RolePicker({ value, onChange, disabled }: { value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t('team.role')} className="space-y-1.5">
      {ROLES.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(r)}
            className={cn(
              'focus-ring flex w-full items-center gap-3 rounded-control p-3 text-left transition-colors disabled:opacity-60',
              active ? 'bg-accent-soft ring-2 ring-accent' : 'edge hover:bg-surface-2',
            )}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border-2',
                active ? 'border-accent' : 'border-border-strong',
              )}
            >
              {active && <span className="size-2.5 rounded-full bg-accent" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t(`roles.${r}`)}</span>
              <span className="block text-sm text-fg-muted">{t(`roles.${r}_desc`)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function InviteSheet({ open, onClose, orgName, shown }: { open: boolean; onClose: () => void; orgName: string; shown?: InvitationDto | null }) {
  const { t } = useTranslation();
  const [createdHere, setCreated] = useState<InvitationDto | null>(null);
  const created = createdHere ?? shown ?? null;
  const departments = useDepartments(open);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof createInvitationSchema>, unknown, CreateInvitationInput>({ resolver: zodResolver(createInvitationSchema), defaultValues: { role: 'EMPLOYEE' } });

  const link = created ? appUrl(`/invite/${created.token}`) : '';

  const close = (): void => {
    onClose();
    // Tras la animación de cierre, para que no se vea el cambio de contenido.
    setTimeout(() => {
      setCreated(null);
      reset();
    }, 300);
  };

  const submit = handleSubmit(async (dto) => {
    try {
      setCreated(await api<InvitationDto>('/invitations', { method: 'POST', body: dto }));
      void queryClient.invalidateQueries({ queryKey: ['invitations'] });
    } catch (e) {
      toast.error(errorMessage(t, e));
    }
  });

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('errors.UNKNOWN'));
    }
  };

  if (created) {
    return (
      <Sheet
        open={open}
        onClose={close}
        title={t(created.emailed ? 'team.emailSentTitle' : 'team.linkReady')}
        description={t(created.emailed ? 'team.emailSentDesc' : 'team.linkReadyDesc', { email: created.email })}
      >
        <div className="space-y-3 pt-1">
          {created.emailed && (
            <p className="flex items-start gap-2.5 rounded-2xl bg-success-soft px-4 py-3 text-sm font-medium text-success-text">
              <MailCheck className="mt-0.5 size-4 shrink-0" />
              {t('team.emailSentNote')}
            </p>
          )}
          <output className="edge block rounded-control bg-surface-2 px-3.5 py-3 font-mono text-[13px] break-all select-all">
            {link}
          </output>
          <div className="flex gap-2.5">
            <Button block size="lg" onClick={copy} icon={<Copy className="size-5" />}>
              {t('common.copy')}
            </Button>
            {typeof navigator.share === 'function' && (
              <Button
                variant="secondary"
                size="lg"
                aria-label={t('common.share')}
                onClick={() => void navigator.share({ text: t('team.shareText', { org: orgName }), url: link }).catch(() => undefined)}
                icon={<Share2 className="size-5" />}
              />
            )}
          </div>
          <Button variant="ghost" block onClick={close}>
            {t('team.done')}
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={close} title={t('team.inviteTitle')} description={t('team.inviteDesc')}>
      <form onSubmit={submit} className="space-y-4 pt-1" noValidate>
        <Field
          label={t('auth.email')}
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoComplete="off"
          icon={<Mail />}
          error={fieldMessage(t, errors.email)}
          {...register('email')}
        />
        <Field label={t('team.fullNameOptional')} autoComplete="off" hint={t('team.fullNameHint')} error={fieldMessage(t, errors.fullName)} {...register('fullName', { setValueAs: (v: string) => v.trim() || undefined })} />
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('team.role')}</p>
          <Controller control={control} name="role" render={({ field }) => <RolePicker value={field.value ?? 'EMPLOYEE'} onChange={field.onChange} />} />
        </div>
        {(departments.data ?? []).length > 0 && (
          <div>
            <label htmlFor="invite-department" className="mb-1.5 block text-sm font-medium">
              {t('team.department')}
            </label>
            <select id="invite-department" className={selectClass} {...register('departmentId', { setValueAs: (v: string) => v || null })}>
              <option value="">{t('team.noDepartment')}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" size="lg" block loading={isSubmitting} icon={<MailPlus className="size-5" />}>
          {t('team.createLink')}
        </Button>
      </form>
    </Sheet>
  );
}

/** Condiciones de una persona: días de vacaciones (si no son los de la empresa) y jornada anual del convenio. */
function MemberTerms({ member, onSave, busy }: { member: MemberDto; onSave: (dto: UpdateMemberInput) => void; busy: boolean }) {
  const { t } = useTranslation();
  const departments = useDepartments();
  const [vacation, setVacation] = useState(member.vacationDays === null ? '' : String(member.vacationDays));
  const [annual, setAnnual] = useState(member.annualHours === null ? '' : String(member.annualHours));
  const [weekly, setWeekly] = useState(member.weeklyHours === null ? '' : String(member.weeklyHours));
  const [cost, setCost] = useState(member.hourlyCost === null ? '' : String(member.hourlyCost));
  const [department, setDepartment] = useState(member.department?.id ?? '');
  const num = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));
  const dirty =
    num(vacation) !== member.vacationDays ||
    num(annual) !== member.annualHours ||
    num(weekly) !== member.weeklyHours ||
    num(cost) !== member.hourlyCost ||
    (department || null) !== (member.department?.id ?? null);
  return (
    <div className="edge-t space-y-3 pt-4">
      <p className="text-sm font-medium">{t('team.terms')}</p>
      {(departments.data ?? []).length > 0 && (
        <div>
          <label htmlFor="member-department" className="mb-1.5 block text-sm font-medium">
            {t('team.department')}
          </label>
          <select id="member-department" className={selectClass} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">{t('team.noDepartment')}</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('team.vacationDays')} hint={t('team.vacationDaysHint')} type="number" min={0} max={60} inputMode="numeric" value={vacation} onChange={(e) => setVacation(e.target.value)} />
        <Field label={t('team.annualHours')} hint={t('team.annualHoursHint')} type="number" min={0} max={3000} step="0.5" inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} />
        <Field label={t('team.weeklyHours')} type="number" min={0} max={60} step="0.5" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value)} />
        <Field label={t('team.hourlyCost')} hint={t('team.hourlyCostHint')} type="number" min={0} max={1000} step="0.01" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
      </div>
      <Button
        variant="secondary"
        block
        disabled={!dirty}
        loading={busy}
        onClick={() => onSave({ vacationDays: num(vacation), annualHours: num(annual), weeklyHours: num(weekly), hourlyCost: num(cost), departmentId: department || null })}
      >
        {t('common.save')}
      </Button>
    </div>
  );
}

/** Tarjeta con QR para identificarse en el quiosco y borrado del PIN (si lo ha olvidado). */
function MemberKiosk({ member }: { member: MemberDto }) {
  const { t } = useTranslation();
  const card = useMutation({
    mutationFn: () => apiDownload(`/members/${member.id}/kiosk-card.pdf`, 'tarjeta.pdf'),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const clearPin = useMutation({
    mutationFn: () => api<void>(`/members/${member.id}/kiosk-pin`, { method: 'DELETE' }),
    onSuccess: () => toast.success(t('team.kioskPinResetDone')),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const manual = useMutation({
    mutationFn: () => api<{ emailed: boolean }>(`/members/${member.id}/manual`, { method: 'POST' }),
    onSuccess: ({ emailed }) => (emailed ? toast.success(t('team.sendManualDone', { name: member.fullName })) : toast.error(t('team.sendManualFailed'))),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  return (
    <div className="edge-t space-y-3 pt-4">
      <p className="text-sm font-medium">{t('team.kioskTitle')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" loading={card.isPending} onClick={() => card.mutate()} icon={<CreditCard className="size-4" />}>
          {t('team.kioskCard')}
        </Button>
        <Button
          variant="ghost"
          loading={clearPin.isPending}
          onClick={() => window.confirm(t('team.kioskPinResetConfirm', { name: member.fullName })) && clearPin.mutate()}
          icon={<KeyRound className="size-4" />}
        >
          {t('team.kioskPinReset')}
        </Button>
      </div>
      <p className="text-sm text-fg-muted">{t('team.kioskCardHint')}</p>
      <Button variant="secondary" block loading={manual.isPending} onClick={() => manual.mutate()} icon={<BookOpen className="size-4" />}>
        {t('team.sendManual')}
      </Button>
      <p className="text-sm text-fg-muted">{t('team.sendManualHint')}</p>
    </div>
  );
}

function MemberSheet({ member, onClose }: { member: MemberDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const isAdmin = ws.kind === 'organization' && ws.role === 'ADMIN';
  const update = useMutation({
    mutationFn: (dto: UpdateMemberInput) => api<void>(`/members/${member!.id}`, { method: 'PATCH', body: dto }),
    onSuccess: (_, dto) => {
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      toast.success(dto.role ? t('team.roleChanged') : dto.active === true ? t('team.reactivated') : dto.active === false ? t('team.deactivated') : t('common.saved'));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  return (
    <Sheet open={!!member} onClose={onClose} title={t('team.memberTitle')}>
      {member && (
        <div className="space-y-4 pt-1">
          <div className="flex items-center gap-3">
            <Avatar name={member.fullName} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold tracking-tight">{member.fullName}</p>
              <p className="truncate text-sm text-fg-muted">{member.email}</p>
            </div>
          </div>
          {member.active && (
            <div>
              <p className="mb-1.5 text-sm font-medium">{t('team.role')}</p>
              <RolePicker value={member.role} disabled={update.isPending} onChange={(role) => role !== member.role && update.mutate({ role })} />
            </div>
          )}
          {member.active && isAdmin && member.role !== 'INSPECTOR' && <MemberTerms key={member.id} member={member} busy={update.isPending} onSave={(dto) => update.mutate(dto)} />}
          {member.active && isAdmin && member.role !== 'INSPECTOR' && <MemberKiosk member={member} />}
          <div className="edge-t pt-4">
            {member.active ? (
              <>
                <Button variant="secondary" block className="text-danger-text" loading={update.isPending} onClick={() => update.mutate({ active: false })}>
                  {t('team.deactivate')}
                </Button>
                <p className="mt-2 text-center text-sm text-fg-muted">{t('team.deactivateDesc')}</p>
              </>
            ) : (
              <Button block loading={update.isPending} onClick={() => update.mutate({ active: true })}>
                {t('team.reactivate')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function Team() {
  const { t, i18n } = useTranslation();
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const [inviting, setInviting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resent, setResent] = useState<InvitationDto | null>(null);
  const [selected, setSelected] = useState<MemberDto | null>(null);

  const orgId = ws.kind === 'organization' ? ws.organizationId : null;
  const isAdmin = ws.kind === 'organization' && ws.role === 'ADMIN';
  const canSeeInvites = ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');

  const members = useQuery({ queryKey: ['members', orgId], queryFn: () => api<MemberDto[]>('/members'), enabled: !!orgId });
  const invitations = useQuery({
    queryKey: ['invitations', orgId],
    queryFn: () => api<InvitationDto[]>('/invitations'),
    enabled: !!orgId && canSeeInvites,
  });
  if (ws.kind !== 'organization') {
    return (
      <div className="animate-page">
        <PageHeader title={t('team.title')} />
        <Card>
          <EmptyState icon={<Users />} title={t('team.title')} body={t('team.onlyOrg')} />
        </Card>
      </div>
    );
  }

  const list = members.data ?? [];

  return (
    <div className="animate-page space-y-6">
      <PageHeader
        title={t('team.title')}
        subtitle={members.data ? `${ws.name} · ${t('team.count', { count: list.filter((m) => m.active).length })}` : ws.name}
        action={
          isAdmin && (
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => setImporting(true)} icon={<FileSpreadsheet className="size-[18px]" />}>
                <span className="max-sm:sr-only">{t('team.importOpen')}</span>
              </Button>
              <Button onClick={() => setInviting(true)} icon={<UserPlus className="size-[18px]" />}>
                {t('team.invite')}
              </Button>
            </span>
          )
        }
      />

      <Card className="overflow-hidden">
        {members.isPending ? (
          <div className="flex justify-center py-12 text-fg-subtle">
            <Spinner className="size-6" />
          </div>
        ) : members.isError ? (
          <EmptyState
            icon={<Users />}
            title={errorMessage(t, members.error)}
            body=""
            action={<Button variant="secondary" onClick={() => void members.refetch()}>{t('common.retry')}</Button>}
          />
        ) : (
          <ul>
            {list.map((m, i) => {
              const row = (
                <>
                  <Avatar name={m.fullName} className={cn(!m.active && 'opacity-40 grayscale')} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('flex items-center gap-2 font-semibold', !m.active && 'text-fg-muted')}>
                      <span className="truncate">{m.fullName}</span>
                      {m.userId === me.id && <span className="text-xs font-medium text-fg-subtle">({t('common.you')})</span>}
                    </span>
                    <span className="block truncate text-sm text-fg-muted">
                      {m.email}
                      {m.department && ` · ${m.department.name}`}
                    </span>
                  </span>
                  {m.active ? <Badge tone={roleTone[m.role]}>{t(`roles.${m.role}`)}</Badge> : <Badge>{t('team.inactive')}</Badge>}
                  {isAdmin && <ChevronRight className="size-5 shrink-0 text-fg-subtle" />}
                </>
              );
              const cls = cn('flex w-full items-center gap-3 px-4 py-3 text-left', i > 0 && 'edge-t');
              return (
                <li key={m.id}>
                  {isAdmin ? (
                    <button type="button" onClick={() => setSelected(m)} className={cn(cls, 'focus-ring transition-colors hover:bg-surface-2')}>
                      {row}
                    </button>
                  ) : (
                    <div className={cls}>{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {members.data && list.length === 1 && isAdmin && (
          <div className="edge-t">
            <EmptyState
              icon={<UserPlus />}
              title={t('team.emptyTitle')}
              body={t('team.emptyBody')}
              action={<Button onClick={() => setInviting(true)}>{t('team.invite')}</Button>}
            />
          </div>
        )}
      </Card>

      <InvitationsSection invitations={invitations.data ?? []} isAdmin={isAdmin} onLink={setResent} />
      {canSeeInvites && <DepartmentsSection members={list} isAdmin={isAdmin} />}

      <InviteSheet
        open={inviting || !!resent}
        onClose={() => {
          setInviting(false);
          setResent(null);
        }}
        orgName={ws.name}
        shown={resent}
      />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
      <MemberSheet member={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
