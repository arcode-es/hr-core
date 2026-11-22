import { zodResolver } from '@hookform/resolvers/zod';
import { CreateOrganizationInput, createOrganizationSchema, WorkspaceSummary } from '@hr/shared';
import { Building2, Check, ChevronsUpDown, Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage, fieldMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useMode } from '../stores/meta';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';

function WorkspaceIcon({ ws, size = 'md' }: { ws: WorkspaceSummary; size?: 'sm' | 'md' }) {
  if (ws.kind === 'organization') return <Avatar name={ws.name} shape="square" size={size} />;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text',
        size === 'sm' ? 'size-8' : 'size-10',
      )}
    >
      <UserRound className={size === 'sm' ? 'size-4' : 'size-5'} />
    </span>
  );
}

/** Abre el formulario de nueva empresa desde cualquier pantalla. */
export function CreateOrganizationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { reload, setWorkspace } = useSession();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrganizationInput>({ resolver: zodResolver(createOrganizationSchema) });

  const submit = handleSubmit(async (dto) => {
    try {
      const ws = await api<Extract<WorkspaceSummary, { kind: 'organization' }>>('/organizations', {
        method: 'POST',
        body: dto,
      });
      await reload();
      setWorkspace(ws.organizationId);
      queryClient.clear();
      toast.success(t('workspace.created'));
      reset();
      onClose();
    } catch (e) {
      toast.error(errorMessage(t, e));
    }
  });

  return (
    <Sheet open={open} onClose={onClose} title={t('workspace.createTitle')} description={t('workspace.createDesc')}>
      <form onSubmit={submit} className="space-y-4 pt-1" noValidate>
        <Field
          label={t('workspace.name')}
          placeholder={t('workspace.namePlaceholder')}
          icon={<Building2 />}
          autoComplete="organization"
          error={fieldMessage(t, errors.name)}
          {...register('name')}
        />
        <Field
          label={t('workspace.taxId')}
          hint={t('workspace.taxIdHint')}
          autoCapitalize="characters"
          error={fieldMessage(t, errors.taxId)}
          {...register('taxId')}
        />
        <Button type="submit" size="lg" block loading={isSubmitting}>
          {t('workspace.create')}
        </Button>
      </form>
    </Sheet>
  );
}

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { workspaces, workspaceId, setWorkspace } = useSession();
  const current = useWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // Crear empresas solo en instalaciones abiertas; en la demo y en un cliente hay una sola.
  const canCreate = useMode() === 'open';

  const nameOf = (ws: WorkspaceSummary): string => (ws.kind === 'organization' ? ws.name : t('workspace.personal'));
  const idOf = (ws: WorkspaceSummary): string => (ws.kind === 'organization' ? ws.organizationId : 'personal');

  // Con un único espacio y sin poder crear otro no hay nada que elegir: se muestra el nombre, sin menú.
  if (!canCreate && workspaces.length <= 1) {
    return (
      <div className={cn('flex min-w-0 items-center gap-2.5', compact ? 'py-1 pr-2 pl-1' : 'edge w-full rounded-2xl bg-surface p-2.5')}>
        <WorkspaceIcon ws={current} size={compact ? 'sm' : 'md'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-tight font-semibold">{nameOf(current)}</span>
          <span className="block truncate text-xs leading-tight text-fg-muted">
            {current.kind === 'organization' ? t(`roles.${current.role}`) : t('workspace.personalDesc')}
          </span>
        </span>
      </div>
    );
  }

  const choose = (ws: WorkspaceSummary): void => {
    setOpen(false);
    if (idOf(ws) === workspaceId) return;
    setWorkspace(idOf(ws));
    queryClient.clear();
    toast.info(t('workspace.switched', { name: nameOf(ws) }));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${t('workspace.switch')}: ${nameOf(current)}`}
        className={cn(
          'focus-ring flex min-w-0 items-center gap-2.5 rounded-2xl text-left transition-colors hover:bg-surface-2',
          compact ? 'py-1 pr-2 pl-1' : 'edge w-full bg-surface p-2.5',
        )}
      >
        <WorkspaceIcon ws={current} size={compact ? 'sm' : 'md'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-tight font-semibold">{nameOf(current)}</span>
          <span className="block truncate text-xs leading-tight text-fg-muted">
            {current.kind === 'organization' ? t(`roles.${current.role}`) : t('workspace.personalDesc')}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('workspace.switch')} description={t('workspace.switchDesc')}>
        <ul className="space-y-1.5 pt-1">
          {workspaces.map((ws) => {
            const active = idOf(ws) === workspaceId;
            return (
              <li key={idOf(ws)}>
                <button
                  type="button"
                  onClick={() => choose(ws)}
                  aria-current={active || undefined}
                  className={cn(
                    'focus-ring flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors',
                    active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <WorkspaceIcon ws={ws} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{nameOf(ws)}</span>
                    <span className="block truncate text-sm text-fg-muted">
                      {ws.kind === 'organization' ? t(`roles.${ws.role}`) : t('workspace.personalDesc')}
                    </span>
                  </span>
                  {active ? (
                    <Check className="size-5 shrink-0 text-accent-text" aria-label={t('workspace.current')} />
                  ) : (
                    ws.kind === 'organization' && ws.role === 'ADMIN' && <Badge tone="accent">{t('roles.ADMIN')}</Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {canCreate && (
          <Button
            variant="secondary"
            block
            className="mt-3"
            icon={<Plus className="size-4" />}
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            {t('workspace.create')}
          </Button>
        )}
      </Sheet>

      <CreateOrganizationSheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
