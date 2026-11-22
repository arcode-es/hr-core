import { useQuery } from '@tanstack/react-query';
import { CircleAlert, MailCheck, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { useSession } from '../stores/session';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { AuthLayout } from './AuthLayout';

/** Cuenta sin ninguna empresa activa en una instalación sin espacio personal. */
export function NoAccess() {
  const { t } = useTranslation();
  const logout = useSession((s) => s.logout);
  return (
    <AuthLayout title={t('access.noneTitle')} subtitle={t('access.noneBody')}>
      <span className="mb-6 flex size-14 items-center justify-center rounded-3xl bg-warning-soft text-warning-text">
        <ShieldOff className="size-7" aria-hidden="true" />
      </span>
      <Button variant="secondary" size="lg" block onClick={() => void logout()}>
        {t('settings.logout')}
      </Button>
    </AuthLayout>
  );
}

/** Enlace del correo de confirmación. Funciona con o sin sesión abierta. */
export function VerifyEmail() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const status = useSession((s) => s.status);
  const reload = useSession((s) => s.reload);
  const check = useQuery({
    queryKey: ['verify-email', token],
    queryFn: async () => {
      await api('/auth/verify-email', { method: 'POST', body: { token }, auth: false });
      if (useSession.getState().status === 'authed') await reload().catch(() => undefined);
      return true;
    },
    enabled: token.length >= 20,
    retry: false,
    staleTime: Infinity,
  });

  if (token.length >= 20 && check.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-fg-subtle" role="status" aria-label={t('verify.checking')}>
        <Spinner className="size-7" />
      </div>
    );
  }
  const ok = check.isSuccess;
  return (
    <AuthLayout title={ok ? t('verify.doneTitle') : t('verify.invalidTitle')} subtitle={ok ? t('verify.doneBody') : t('verify.invalidBody')}>
      <span className={`mb-6 flex size-14 items-center justify-center rounded-3xl ${ok ? 'bg-success-soft text-success-text' : 'bg-warning-soft text-warning-text'}`}>
        {ok ? <MailCheck className="size-7" aria-hidden="true" /> : <CircleAlert className="size-7" aria-hidden="true" />}
      </span>
      <Link to={status === 'authed' ? '/' : '/login'} className="block">
        <Button size="lg" block>
          {t('verify.continue')}
        </Button>
      </Link>
    </AuthLayout>
  );
}
