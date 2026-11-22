import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordInput, changePasswordSchema, type DeleteAccountInput, deleteAccountSchema, type EmailPrefs, type SessionDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Grid3x3, KeyRound, Lock, MonitorSmartphone, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { api, apiDownload } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage, fieldMessage } from '../lib/errors';
import { disablePush, enablePush, type PushState, pushState } from '../lib/push';
import { queryClient } from '../lib/query';
import { useMode } from '../stores/meta';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';
import { Field } from '../ui/Field';
import { Sheet } from '../ui/Sheet';
import { Switch } from '../ui/Switch';
import { LegalLinks } from './Legal';

export function PushSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  const toggle = async (on: boolean): Promise<void> => {
    setBusy(true);
    try {
      const next = on ? await enablePush() : await disablePush();
      setState(next);
      if (next === 'on') toast.success(t('settings.pushEnabled'));
      else if (next === 'off' && !on) toast.info(t('settings.pushDisabled'));
    } catch (e) {
      toast.error(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const blocked = state === 'unsupported' || state === 'unavailable' || state === 'denied';
  return (
    <section aria-labelledby="notif-title">
      <SectionTitle id="notif-title" className="mb-2.5">
        {t('settings.notifications')}
      </SectionTitle>
      <Card className="p-4 sm:p-5">
        <Switch checked={state === 'on'} disabled={busy || state === null || blocked} onChange={(v) => void toggle(v)} label={t('settings.push')} hint={t('settings.pushHint')} />
        {blocked && <p className="mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-fg-muted">{t(`settings.push_${state}`)}</p>}
      </Card>
    </section>
  );
}

export function PasswordSettings() {
  const { t } = useTranslation();
  const demo = useMode() === 'demo';
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  const submit = handleSubmit(async (dto) => {
    try {
      await api('/auth/password', { method: 'POST', body: dto });
      reset();
      toast.success(t('settings.passwordChanged'));
    } catch (e) {
      setError('currentPassword', { message: errorMessage(t, e) });
    }
  });

  return (
    <section aria-labelledby="password-title">
      <SectionTitle id="password-title" className="mb-2.5">
        {t('settings.password')}
      </SectionTitle>
      <Card className="p-4 sm:p-5">
        {demo ? (
          <p className="text-sm text-fg-muted">{t('demo.noPassword')}</p>
        ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('settings.currentPassword')}
              type="password"
              autoComplete="current-password"
              icon={<Lock />}
              error={errors.currentPassword?.message || fieldMessage(t, errors.currentPassword)}
              {...register('currentPassword')}
            />
            <Field
              label={t('settings.newPassword')}
              type="password"
              autoComplete="new-password"
              icon={<KeyRound />}
              hint={t('auth.passwordHint')}
              error={fieldMessage(t, errors.newPassword)}
              {...register('newPassword')}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" loading={isSubmitting} className="max-sm:w-full">
              {t('settings.changePassword')}
            </Button>
          </div>
        </form>
        )}
      </Card>
    </section>
  );
}

const EMAIL_GROUPS = ['documents', 'requests', 'pending', 'schedule', 'alerts', 'digest'] as const;

/** Qué avisos llegan también por correo. Se guarda al tocar cada interruptor. */
export function EmailPrefsSettings() {
  const { t } = useTranslation();
  const demo = useMode() === 'demo';
  const ws = useWorkspace();
  const supervises = ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');
  const loaded = useQuery({ queryKey: ['email-prefs'], queryFn: () => api<EmailPrefs>('/me/email-prefs') }).data;
  // Lo que la persona acaba de elegir manda sobre lo cargado: el interruptor cambia en el mismo
  // clic, sin esperar a que la caché de consultas avise (que llega un instante después).
  const [chosen, setChosen] = useState<EmailPrefs | null>(null);
  const data = chosen ?? loaded;
  const save = useMutation({
    mutationFn: (prefs: EmailPrefs) => api<EmailPrefs>('/me/email-prefs', { method: 'PUT', body: prefs }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['email-prefs'], saved);
      toast.success(t('settings.emailPrefsSaved'));
    },
    onError: (e) => {
      toast.error(errorMessage(t, e));
      setChosen(null);
      void queryClient.invalidateQueries({ queryKey: ['email-prefs'] });
    },
  });
  if (demo) return null;
  // Lo de validar y el resumen solo tienen sentido para quien supervisa.
  const groups = EMAIL_GROUPS.filter((g) => supervises || (g !== 'pending' && g !== 'digest'));
  return (
    <section aria-labelledby="email-prefs-title">
      <SectionTitle id="email-prefs-title" className="mb-2.5">
        {t('settings.emailPrefs')}
      </SectionTitle>
      <Card className="space-y-4 p-4 sm:p-5">
        <p className="text-sm text-fg-muted">{t('settings.emailPrefsDesc')}</p>
        {data &&
          groups.map((g, i) => (
            <div key={g} className={cn(i > 0 && 'edge-t pt-4')}>
              <Switch
                checked={data[g]}
                onChange={(v) => {
                  // Si el servidor falla, se recarga lo guardado.
                  const next = { ...data, [g]: v };
                  setChosen(next);
                  save.mutate(next);
                }}
                label={t(`settings.emailPref.${g}`)}
                hint={t(`settings.emailPref.${g}_hint`)}
              />
            </div>
          ))}
      </Card>
    </section>
  );
}

/** PIN para fichar en el quiosco de la empresa: lo elige cada persona y nadie más lo conoce. */
export function KioskPinSettings() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const workspaceId = useSession((s) => s.workspaceId);
  const enabled = ws.kind === 'organization' && ws.role !== 'INSPECTOR';
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | undefined>();
  const status = useQuery({ queryKey: ['kiosk-pin', workspaceId], queryFn: () => api<{ set: boolean }>('/me/kiosk-pin'), enabled });
  const save = useMutation({
    mutationFn: () => api<void>('/me/kiosk-pin', { method: 'PUT', body: { pin } }),
    onSuccess: () => {
      setPin('');
      setRepeat('');
      queryClient.setQueryData(['kiosk-pin', workspaceId], { set: true });
      toast.success(t('settings.kioskPinSaved'));
    },
    onError: (e) => setError(errorMessage(t, e)),
  });
  if (!enabled) return null;
  const digits = (v: string): string => v.replace(/\D/g, '').slice(0, 6);
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) return setError(t('settings.kioskPinInvalid'));
    if (pin !== repeat) return setError(t('settings.kioskPinMismatch'));
    setError(undefined);
    save.mutate();
  };
  return (
    <section aria-labelledby="kiosk-pin-title">
      <SectionTitle id="kiosk-pin-title" className="mb-2.5">
        {t('settings.kioskPin')}
      </SectionTitle>
      <Card className="p-4 sm:p-5">
        <p className="text-sm text-fg-muted">{t('settings.kioskPinDesc')}</p>
        {status.data && (
          <p className="mt-2">
            <Badge tone={status.data.set ? 'success' : 'warning'}>{t(status.data.set ? 'settings.kioskPinSet' : 'settings.kioskPinNotSet')}</Badge>
          </p>
        )}
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('settings.kioskPinNew')}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              icon={<Grid3x3 />}
              value={pin}
              onChange={(e) => setPin(digits(e.target.value))}
              error={error}
            />
            <Field
              label={t('settings.kioskPinRepeat')}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              icon={<Grid3x3 />}
              value={repeat}
              onChange={(e) => setRepeat(digits(e.target.value))}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" loading={save.isPending} disabled={pin.length < 4} className="max-sm:w-full">
              {t('settings.kioskPinSave')}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

/** Nombre legible de un navegador a partir de su user-agent: «Chrome en Android». */
function deviceName(ua: string | null, unknown: string): string {
  if (!ua) return unknown;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  return browser && os ? `${browser} · ${os}` : (browser ?? os ?? unknown);
}

export function SessionsSettings() {
  const { t, i18n } = useTranslation();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<SessionDto[]>('/auth/sessions') });
  const date = (iso: string): string => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const revoke = async (id: string | null): Promise<void> => {
    try {
      await api(id ? `/auth/sessions/${id}` : '/auth/sessions', { method: 'DELETE' });
      toast.success(id ? t('sessions.closed') : t('sessions.closedOthers'));
      await sessions.refetch();
    } catch (e) {
      toast.error(errorMessage(t, e));
    }
  };
  const others = (sessions.data ?? []).filter((s) => !s.current);
  return (
    <section aria-labelledby="sessions-title">
      <SectionTitle id="sessions-title" className="mb-2.5">
        {t('sessions.title')}
      </SectionTitle>
      <Card className="p-4 sm:p-5">
        <p className="mb-3 text-sm text-fg-muted">{t('sessions.desc')}</p>
        <ul className="divide-y divide-border">
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg-muted">
                <MonitorSmartphone className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="truncate">{deviceName(s.userAgent, t('sessions.unknownDevice'))}</span>
                  {s.current && <Badge tone="success">{t('sessions.current')}</Badge>}
                </span>
                <span className="block truncate text-sm text-fg-muted">
                  {t('sessions.lastUsed', { date: date(s.lastUsedAt) })}
                  {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                </span>
              </span>
              {!s.current && (
                <Button variant="secondary" size="sm" onClick={() => void revoke(s.id)} aria-label={`${t('sessions.close')}: ${deviceName(s.userAgent, t('sessions.unknownDevice'))}`}>
                  {t('sessions.close')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {sessions.isSuccess && (others.length > 0 ? (
          <Button variant="secondary" block className="mt-4 text-danger-text" onClick={() => void revoke(null)}>
            {t('sessions.closeOthers')}
          </Button>
        ) : (
          <p className="mt-3 text-sm text-fg-muted">{t('sessions.onlyThis')}</p>
        ))}
      </Card>
    </section>
  );
}

/** Privacidad: descargar mis datos, textos legales y, en instalaciones abiertas, borrar la cuenta. */
export function PrivacySettings() {
  const { t } = useTranslation();
  const open = useMode() === 'open';
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const exportData = async (): Promise<void> => {
    setExporting(true);
    try {
      await apiDownload('/me/export', 'mis-datos-hr-core.zip');
    } catch (e) {
      toast.error(errorMessage(t, e));
    } finally {
      setExporting(false);
    }
  };
  return (
    <section aria-labelledby="privacy-title">
      <SectionTitle id="privacy-title" className="mb-2.5">
        {t('privacy.title')}
      </SectionTitle>
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('privacy.export')}</p>
            <p className="text-sm text-fg-muted">{t('privacy.exportHint')}</p>
          </div>
          <Button variant="secondary" loading={exporting} onClick={() => void exportData()} icon={<Download className="size-4" />} className="max-sm:w-full">
            {t('privacy.download')}
          </Button>
        </div>
        {open && (
          <div className="edge-t flex flex-wrap items-center gap-3 pt-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t('privacy.delete')}</p>
              <p className="text-sm text-fg-muted">{t('privacy.deleteHint')}</p>
            </div>
            <Button variant="secondary" className="text-danger-text max-sm:w-full" onClick={() => setDeleting(true)} icon={<Trash2 className="size-4" />}>
              {t('privacy.deleteButton')}
            </Button>
          </div>
        )}
        <LegalLinks className="edge-t justify-start! pt-4" />
      </Card>
      <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />
    </section>
  );
}

function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const logout = useSession((s) => s.logout);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DeleteAccountInput>({ resolver: zodResolver(deleteAccountSchema) });
  const submit = handleSubmit(async (dto) => {
    try {
      await api('/me/delete', { method: 'POST', body: dto });
      toast.success(t('privacy.deleted'));
      await logout();
    } catch (e) {
      setError('password', { message: errorMessage(t, e) });
    }
  });
  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('privacy.deleteTitle')}
      description={t('privacy.deleteDesc')}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted marker:text-fg-subtle">
          <li>{t('privacy.deleteWhat1')}</li>
          <li>{t('privacy.deleteWhat2')}</li>
          <li>{t('privacy.deleteWhat3')}</li>
        </ul>
        <Field
          label={t('privacy.confirmPassword')}
          type="password"
          autoComplete="current-password"
          icon={<Lock />}
          error={errors.password?.message || fieldMessage(t, errors.password)}
          {...register('password')}
        />
        <Button type="submit" variant="danger" block size="lg" loading={isSubmitting}>
          {t('privacy.deleteConfirm')}
        </Button>
      </form>
    </Sheet>
  );
}
