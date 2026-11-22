import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPasswordInput, forgotPasswordSchema } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, KeyRound, Lock, Mail, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api } from '../lib/api';
import { errorMessage, fieldMessage } from '../lib/errors';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Spinner } from '../ui/Spinner';
import { AuthLayout } from './AuthLayout';

/** Pedir el enlace para restablecer la contraseña. */
export function ForgotPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: params.get('email') ?? '' } });

  const submit = handleSubmit(async (dto) => {
    try {
      await api('/auth/forgot-password', { method: 'POST', body: dto, auth: false });
      setSentTo(dto.email);
    } catch (e) {
      setError('root', { message: errorMessage(t, e) });
    }
  });

  const back = (
    <Link to="/login" className="font-semibold text-accent-text hover:underline">
      {t('reset.backToLogin')}
    </Link>
  );

  if (sentTo) {
    return (
      <AuthLayout title={t('reset.sentTitle')} subtitle={t('reset.sentBody', { email: sentTo })} footer={back}>
        <div className="flex items-start gap-3 rounded-2xl bg-accent-soft px-4 py-3.5 text-sm text-accent-text">
          <MailCheck className="mt-0.5 size-5 shrink-0" />
          <p>{t('reset.sentHint')}</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('reset.forgotTitle')} subtitle={t('reset.forgotSubtitle')} footer={back}>
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
        {errors.root && (
          <p role="alert" className="rounded-control bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger-text">
            {errors.root.message}
          </p>
        )}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          {t('reset.sendLink')}
        </Button>
      </form>
    </AuthLayout>
  );
}

const newPasswordSchema = z
  .object({ password: z.string().min(8).max(128), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'mismatch' });

/** Elegir la contraseña nueva desde el enlace del correo. */
export function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const check = useQuery({
    queryKey: ['reset-check', token],
    queryFn: () => api<{ valid: boolean }>('/auth/reset-password/check', { method: 'POST', body: { token }, auth: false }),
    enabled: token.length >= 20,
    retry: false,
    staleTime: Infinity,
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof newPasswordSchema>>({ resolver: zodResolver(newPasswordSchema) });

  const submit = handleSubmit(async (dto) => {
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: dto.password }, auth: false });
      toast.success(t('reset.done'));
      void navigate('/login', { replace: true });
    } catch (e) {
      setError('root', { message: errorMessage(t, e) });
    }
  });

  if (token.length >= 20 && check.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-fg-subtle">
        <Spinner className="size-7" />
      </div>
    );
  }

  if (!check.data?.valid) {
    return (
      <AuthLayout title={t('reset.invalidTitle')} subtitle={t('reset.invalidBody')}>
        <div className="flex items-start gap-3 rounded-2xl bg-warning-soft px-4 py-3.5 text-sm text-warning-text">
          <CircleAlert className="mt-0.5 size-5 shrink-0" />
          <p>{t('reset.invalidHint')}</p>
        </div>
        <Link to="/forgot-password" className="mt-4 block">
          <Button size="lg" block>
            {t('reset.requestNew')}
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('reset.newTitle')} subtitle={t('reset.newSubtitle')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label={t('settings.newPassword')}
          type="password"
          autoComplete="new-password"
          icon={<KeyRound />}
          hint={t('auth.passwordHint')}
          error={fieldMessage(t, errors.password)}
          {...register('password')}
        />
        <Field
          label={t('reset.confirm')}
          type="password"
          autoComplete="new-password"
          icon={<Lock />}
          error={errors.confirm ? t('reset.mismatch') : undefined}
          {...register('confirm')}
        />
        {errors.root && (
          <p role="alert" className="rounded-control bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger-text">
            {errors.root.message}
          </p>
        )}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          {t('reset.save')}
        </Button>
      </form>
    </AuthLayout>
  );
}
