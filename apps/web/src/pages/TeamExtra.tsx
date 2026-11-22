import type { DepartmentDto, ImportPreview, ImportResult, ImportRow, InvitationDto, MemberDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Building2, Check, CircleAlert, Download, FileSpreadsheet, Mail, Pencil, Plus, RotateCw, Trash2, UserCog, X } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, apiDownload } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';

export function useDepartments(enabled = true) {
  const workspaceId = useSession((s) => s.workspaceId);
  return useQuery({ queryKey: ['departments', workspaceId], queryFn: () => api<DepartmentDto[]>('/departments'), enabled });
}

const refreshPeople = (): void => {
  for (const key of ['invitations', 'members', 'departments']) void queryClient.invalidateQueries({ queryKey: [key] });
};

// ── Alta masiva ──────────────────────────────────────────────────────────

/** Sube la plantilla, enseña fila a fila lo que se va a invitar y lo que tiene errores, y lo invita. */
export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const valid = (preview?.rows ?? []).filter((r) => r.errors.length === 0);
  const invalid = (preview?.rows ?? []).filter((r) => r.errors.length > 0);

  const close = (): void => {
    onClose();
    setTimeout(() => setPreview(null), 300);
  };
  const read = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return api<ImportPreview>('/invitations/import/preview', { method: 'POST', body: form });
    },
    onSuccess: setPreview,
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const submit = useMutation({
    mutationFn: (rows: ImportRow[]) =>
      api<ImportResult>('/invitations/import', {
        method: 'POST',
        body: { rows: rows.map(({ email, fullName, dniNie, role, department, jobTitle, weeklyHours }) => ({ email, fullName, dniNie, role, department, jobTitle, weeklyHours })) },
      }),
    onSuccess: (r) => {
      refreshPeople();
      toast.success([t('team.importDone', { count: r.invited }), r.departmentsCreated ? t('team.importDepartments', { count: r.departmentsCreated }) : ''].filter(Boolean).join(' '));
      close();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const template = useMutation({
    mutationFn: () => apiDownload('/invitations/import/template.xlsx', 'plantilla-alta-masiva.xlsx'),
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const pick = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) read.mutate(f);
  };

  return (
    <Sheet open={open} onClose={close} title={t('team.importTitle')} description={t('team.importDesc')} className="sm:max-w-2xl">
      <input
        ref={input}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={pick}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="space-y-4 pt-1">
        {!preview ? (
          <>
            <Button variant="secondary" block loading={template.isPending} onClick={() => template.mutate()} icon={<Download className="size-4" />}>
              {t('team.importTemplate')}
            </Button>
            <Button size="lg" block loading={read.isPending} onClick={() => input.current?.click()} icon={<FileSpreadsheet className="size-5" />}>
              {t('team.importPick')}
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{t('team.importValid', { count: valid.length })}</Badge>
              {invalid.length > 0 && <Badge tone="danger">{t('team.importInvalid', { count: invalid.length })}</Badge>}
            </div>
            <ul className="edge max-h-[45dvh] divide-y divide-border overflow-y-auto rounded-2xl">
              {preview.rows.map((r) => (
                <li key={r.line} className={cn('flex items-start gap-3 px-3 py-2.5', r.errors.length && 'bg-danger-soft/40')}>
                  <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', r.errors.length ? 'bg-danger-soft text-danger-text' : 'bg-success-soft text-success-text')}>
                    {r.errors.length ? <CircleAlert className="size-4" /> : <Check className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.fullName || r.email}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {t('team.importLine', { line: r.line })} · {r.email} · {t(`roles.${r.role}`)}
                      {r.department && ` · ${r.department}`}
                      {r.jobTitle && ` · ${r.jobTitle}`}
                    </span>
                    {r.errors.length > 0 && <span className="mt-0.5 block text-xs font-semibold text-danger-text">{r.errors.map((e) => t(`team.importError.${e}`)).join(' · ')}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Button variant="secondary" onClick={() => input.current?.click()} loading={read.isPending}>
                {t('team.importAnother')}
              </Button>
              <Button loading={submit.isPending} disabled={!valid.length} onClick={() => submit.mutate(valid)} icon={<Mail className="size-4" />}>
                {t('team.importSubmit', { count: valid.length })}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

// ── Invitaciones ─────────────────────────────────────────────────────────

const STATUS_TONE = { PENDING: 'warning', ACCEPTED: 'success', EXPIRED: 'neutral' } as const;

/** Invitaciones con su estado; las pendientes o caducadas se pueden reenviar (con un enlace nuevo) o anular. */
export function InvitationsSection({ invitations, isAdmin, onLink }: { invitations: InvitationDto[]; isAdmin: boolean; onLink: (inv: InvitationDto) => void }) {
  const { t, i18n } = useTranslation();
  const date = (iso: string): string => new Intl.DateTimeFormat(i18n.resolvedLanguage, { day: 'numeric', month: 'short' }).format(new Date(iso));
  const resend = useMutation({
    mutationFn: (id: string) => api<InvitationDto>(`/invitations/${id}/resend`, { method: 'POST' }),
    onSuccess: (inv) => {
      refreshPeople();
      toast.success(t('team.resent'));
      onLink(inv);
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api<void>(`/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refreshPeople();
      toast.success(t('team.revoked'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  if (!invitations.length) return null;
  return (
    <section aria-labelledby="invitations-title">
      <SectionTitle id="invitations-title" className="mb-2.5">
        {t('team.invitations')}
      </SectionTitle>
      <Card className="overflow-hidden">
        <ul>
          {invitations.map((inv, i) => (
            <li key={inv.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3', i > 0 && 'edge-t')}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted">
                <Mail className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{inv.fullName ?? inv.email}</span>
                <span className="block truncate text-sm text-fg-muted">
                  {inv.fullName && `${inv.email} · `}
                  {t(`roles.${inv.role}`)}
                  {inv.department && ` · ${inv.department}`}
                  {inv.status === 'PENDING' && ` · ${t('team.expires', { date: date(inv.expiresAt) })}`}
                  {inv.sendCount > 1 && ` · ${t('team.sentTimes', { count: inv.sendCount })}`}
                </span>
              </span>
              <Badge tone={STATUS_TONE[inv.status]}>{t(`team.invStatus.${inv.status}`)}</Badge>
              {isAdmin && inv.status !== 'ACCEPTED' && (
                <span className="flex gap-1">
                  <Button variant="secondary" size="sm" loading={resend.isPending && resend.variables === inv.id} onClick={() => resend.mutate(inv.id)} icon={<RotateCw className="size-4" />}>
                    {t('team.resend')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(inv.id)} aria-label={`${t('team.revoke')}: ${inv.email}`} icon={<X className="size-4" />} />
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

// ── Departamentos ────────────────────────────────────────────────────────

export function DepartmentsSection({ members, isAdmin }: { members: MemberDto[]; isAdmin: boolean }) {
  const { t } = useTranslation();
  const { data } = useDepartments();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<DepartmentDto | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api<DepartmentDto>('/departments', { method: 'POST', body: { name: name.trim() } }),
    onSuccess: () => {
      refreshPeople();
      setName('');
      toast.success(t('team.departmentAdded'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const rename = useMutation({
    mutationFn: (d: { id: string; name: string }) => api<DepartmentDto>(`/departments/${d.id}`, { method: 'PATCH', body: { name: d.name.trim() } }),
    onSuccess: () => {
      refreshPeople();
      setRenaming(null);
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/departments/${id}`, { method: 'DELETE' }),
    onSuccess: refreshPeople,
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (name.trim().length >= 2) create.mutate();
  };
  const list = data ?? [];
  if (!isAdmin && !list.length) return null;

  return (
    <section aria-labelledby="departments-title">
      <SectionTitle id="departments-title" className="mb-2.5">
        {t('team.departments')}
      </SectionTitle>
      <Card className="space-y-4 p-4 sm:p-5">
        <p className="text-sm text-fg-muted">{t('team.departmentsDesc')}</p>
        {list.length === 0 ? (
          <p className="text-center text-sm text-fg-muted">{t('team.noDepartments')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
                  <Building2 className="size-5" />
                </span>
                {renaming?.id === d.id ? (
                  <form
                    className="flex min-w-0 flex-1 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renaming.name.trim().length >= 2) rename.mutate(renaming);
                    }}
                  >
                    <label htmlFor={`rename-${d.id}`} className="sr-only">
                      {t('team.departmentName')}
                    </label>
                    <input
                      id={`rename-${d.id}`}
                      value={renaming.name}
                      onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                      maxLength={80}
                      autoFocus
                      className="edge h-10 min-w-0 flex-1 rounded-control bg-surface px-3 text-sm focus:outline-2 focus:outline-(--ring)"
                    />
                    <Button type="submit" size="sm" loading={rename.isPending} aria-label={t('common.save')} icon={<Check className="size-4" />} />
                  </form>
                ) : (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{d.name}</span>
                    <span className="block truncate text-sm text-fg-muted">
                      {t('team.departmentMembers', { count: d.members })} · {d.managers.length ? d.managers.map((m) => m.fullName).join(', ') : t('team.noManagers')}
                    </span>
                  </span>
                )}
                {isAdmin && renaming?.id !== d.id && (
                  <span className="flex gap-1">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(d)} icon={<UserCog className="size-4" />}>
                      {t('team.editManagers')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRenaming({ id: d.id, name: d.name })} aria-label={`${t('team.departmentName')}: ${d.name}`} icon={<Pencil className="size-4" />} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.confirm(t('team.deleteDepartmentConfirm', { name: d.name })) && remove.mutate(d.id)}
                      aria-label={`${t('common.delete')}: ${d.name}`}
                      icon={<Trash2 className="size-4" />}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <form onSubmit={submit} className="edge-t flex items-end gap-2 pt-4" noValidate>
            <div className="min-w-0 flex-1">
              <Field label={t('team.departmentName')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <Button type="submit" variant="secondary" loading={create.isPending} disabled={name.trim().length < 2} icon={<Plus className="size-4" />} className="h-12">
              {t('team.addDepartment')}
            </Button>
          </form>
        )}
      </Card>
      <ManagersSheet department={editing} members={members} onClose={() => setEditing(null)} />
    </section>
  );
}

function ManagersSheet({ department, members, onClose }: { department: DepartmentDto | null; members: MemberDto[]; onClose: () => void }) {
  const { t } = useTranslation();
  const managers = members.filter((m) => m.active && m.role === 'MANAGER');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [lastId, setLastId] = useState<string | null>(null);
  if (department && department.id !== lastId) {
    setLastId(department.id);
    setChosen(new Set(department.managers.map((m) => m.membershipId)));
  }
  const save = useMutation({
    mutationFn: () => api<DepartmentDto>(`/departments/${department!.id}/managers`, { method: 'PUT', body: { membershipIds: [...chosen] } }),
    onSuccess: () => {
      refreshPeople();
      toast.success(t('team.managersSaved'));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  return (
    <Sheet open={!!department} onClose={onClose} title={department ? t('team.managersTitle', { name: department.name }) : ''} description={t('team.managersHint')}>
      <div className="space-y-4 pt-1">
        {managers.length === 0 ? (
          <p className="py-4 text-center text-sm text-fg-muted">{t('team.noManagersAvailable')}</p>
        ) : (
          <ul className="edge divide-y divide-border rounded-2xl">
            {managers.map((m) => {
              const on = chosen.has(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() =>
                      setChosen((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.id)) next.delete(m.id);
                        else next.add(m.id);
                        return next;
                      })
                    }
                    className={cn('focus-ring flex w-full items-center gap-3 px-3 py-3 text-left', on ? 'bg-accent-soft' : 'hover:bg-surface-2')}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{m.fullName}</span>
                    <span className={cn('flex size-6 items-center justify-center rounded-md border-2', on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong')}>
                      {on && <Check className="size-4" strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Button size="lg" block loading={save.isPending} disabled={!managers.length} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
    </Sheet>
  );
}
