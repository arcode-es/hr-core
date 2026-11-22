import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterInput, registerSchema } from '@hr/shared';
import { Lock, Mail, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { errorMessage, fieldMessage } from '../lib/errors';
import { useMode } from '../stores/meta';
import { useSession } from '../stores/session';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { AuthLayout } from './AuthLayout';

export function Register() {
  const { t, i18n } = useTranslation();
  const signUp = useSession((s) => s.register);
  const mode = useMode();
  const [params] = useSearchParams();
  // Quien viene de una invitación trae su enlace en ?next=/invite/<token>: el token demuestra que el correo es suyo.
  const inviteToken = /^\/invite\/([A-Za-z0-9_-]{20,200})$/.exec(params.get('next') ?? '')?.[1];
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    // Con invitación, el correo (y el nombre, si la empresa lo dejó preparado) vienen ya escritos.
    defaultValues: { email: params.get('email') ?? '', fullName: params.get('name')?.slice(0, 120) ?? '' },
  });

  const submit = handleSubmit(async (dto) => {
    try {
      await signUp({ ...dto, inviteToken, locale: i18n.resolvedLanguage === 'en' ? 'en' : 'es' });
    } catch (e) {
      setError('root', { message: errorMessage(t, e) });
    }
  });

  // En el servidor de un cliente solo se entra con invitación; en la demo no hay registro.
  if (mode !== 'open' && !inviteToken) {
    return (
      <AuthLayout title={t('access.inviteOnlyTitle')} subtitle={t('access.inviteOnlyBody')}>
        <Link to="/login" className="block">
          <Button variant="secondary" size="lg" block>
            {t('auth.goLogin')}
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to={{ pathname: '/login', search: params.toString() }} className="font-semibold text-accent-text hover:underline">
            {t('auth.goLogin')}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label={t('auth.fullName')}
          autoComplete="name"
          autoCapitalize="words"
          icon={<UserRound />}
          error={fieldMessage(t, errors.fullName)}
          {...register('fullName')}
        />
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
          autoComplete="new-password"
          icon={<Lock />}
          hint={t('auth.passwordHint')}
          error={fieldMessage(t, errors.password)}
          {...register('password')}
        />
        {errors.root && (
          <p role="alert" className="rounded-control bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger-text">
            {errors.root.message}
          </p>
        )}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          {t('auth.register')}
        </Button>
      </form>
    </AuthLayout>
  );
}
