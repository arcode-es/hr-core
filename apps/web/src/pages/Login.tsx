import { zodResolver } from '@hookform/resolvers/zod';
import { LoginInput, loginSchema, type Role } from '@hr/shared';
import { ChevronRight, Lock, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { errorMessage, fieldMessage } from '../lib/errors';
import { useMeta } from '../stores/meta';
import { useSession } from '../stores/session';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { AuthLayout } from './AuthLayout';

export function Login() {
  const { t } = useTranslation();
  const login = useSession((s) => s.login);
  const meta = useMeta((s) => s.meta);
  const mode = meta?.mode ?? 'open';
  const [params] = useSearchParams();
  const [entering, setEntering] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: params.get('email') ?? '' },
  });

  const submit = handleSubmit(async (dto) => {
    try {
      await login(dto);
    } catch (e) {
      setError('root', { message: errorMessage(t, e) });
    }
  });

  // Demo: un clic por perfil, con la contraseña pública de la demo.
  const enterAs = async (email: string): Promise<void> => {
    setEntering(email);
    try {
      await login({ email, password: meta!.demo!.password });
    } catch (e) {
      setError('root', { message: errorMessage(t, e) });
      setEntering(null);
    }
  };

  return (
    <AuthLayout
      title={mode === 'demo' ? t('demo.title') : t('auth.loginTitle')}
      subtitle={mode === 'demo' ? t('demo.subtitle') : t('auth.loginSubtitle')}
      footer={
        mode === 'open' && (
          <>
            {t('auth.noAccount')}{' '}
            <Link to={{ pathname: '/register', search: params.toString() }} className="font-semibold text-accent-text hover:underline">
              {t('auth.goRegister')}
            </Link>
          </>
        )
      }
    >
      {mode === 'demo' && meta?.demo && (
        <div className="mb-7">
          <ul className="edge divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {meta.demo.accounts.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  onClick={() => void enterAs(a.email)}
                  disabled={entering !== null}
                  aria-label={t('demo.as', { role: `${t(`roles.${a.role}`)} (${a.fullName})` })}
                  className="focus-ring flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  <Avatar name={a.fullName} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.fullName}</span>
                    <span className="line-clamp-2 block text-sm leading-snug text-fg-muted">{t(`demo.role${a.role as Role}`)}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-center text-xs text-fg-muted">
            {t('demo.password', { password: meta.demo.password })} · {t('demo.kioskPin', { pin: meta.demo.kioskPin })}
          </p>
          <p className="mt-6 text-center text-xs font-semibold tracking-wider text-fg-subtle uppercase">{t('demo.orManual')}</p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label={t('auth.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          icon={<Mail />}
          error={fieldMessage(t, errors.email)}
          {...register('email')}
        />
        <Field
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          icon={<Lock />}
          error={fieldMessage(t, errors.password)}
          {...register('password')}
        />
        {mode !== 'demo' && (
          <p className="-mt-1 text-right text-sm">
            <Link to={{ pathname: '/forgot-password', search: params.get('email') ? `?email=${encodeURIComponent(params.get('email')!)}` : '' }} className="font-semibold text-accent-text hover:underline">
              {t('reset.forgotLink')}
            </Link>
          </p>
        )}
        {errors.root && (
          <p role="alert" className="rounded-control bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger-text">
            {errors.root.message}
          </p>
        )}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          {t('auth.login')}
        </Button>
      </form>
    </AuthLayout>
  );
}
