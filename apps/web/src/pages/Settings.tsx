import { zodResolver } from '@hookform/resolvers/zod';
import { SUPPORTED_LOCALES, UpdateProfileInput, updateProfileSchema, UserProfile } from '@hr/shared';
import { IdCard, LogOut, Monitor, Moon, Phone, Sun, SunMedium, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorMessage, fieldMessage } from '../lib/errors';
import { useSession } from '../stores/session';
import { type ThemeMode, useTheme } from '../stores/theme';
import { toast } from '../stores/toast';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card, SectionTitle } from '../ui/Card';
import { Field } from '../ui/Field';
import { PageHeader } from '../ui/Page';
import { Segmented } from '../ui/Segmented';
import { EmailPrefsSettings, KioskPinSettings, PasswordSettings, PrivacySettings, PushSettings, SessionsSettings } from './SettingsExtra';

const LANG_LABEL: Record<string, string> = { es: 'Español', en: 'English' };

export function Settings() {
  const { t, i18n } = useTranslation();
  const { user, setUser, logout } = useSession();
  const { mode, setMode } = useTheme();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { fullName: user!.fullName, dniNie: user!.dniNie ?? '', phone: user!.phone ?? '' },
  });

  const submit = handleSubmit(async (dto) => {
    try {
      const updated = await api<UserProfile>('/me', { method: 'PATCH', body: dto });
      setUser(updated);
      reset({ fullName: updated.fullName, dniNie: updated.dniNie ?? '', phone: updated.phone ?? '' });
      toast.success(t('common.saved'));
    } catch (e) {
      toast.error(errorMessage(t, e));
    }
  });

  const changeLanguage = (lng: string): void => {
    void i18n.changeLanguage(lng);
    void api('/me', { method: 'PATCH', body: { locale: lng } }).catch(() => undefined);
  };

  return (
    <div className="animate-page space-y-7">
      <PageHeader title={t('settings.title')} />

      <section aria-labelledby="profile-title">
        <SectionTitle id="profile-title" className="mb-2.5">
          {t('settings.profile')}
        </SectionTitle>
        <Card className="p-4 sm:p-5">
          <div className="mb-5 flex items-center gap-3.5">
            <Avatar name={user!.fullName} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold tracking-tight">{user!.fullName}</p>
              <p className="truncate text-sm text-fg-muted">{user!.email}</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label={t('auth.fullName')} autoComplete="name" icon={<UserRound />} error={fieldMessage(t, errors.fullName)} {...register('fullName')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('settings.dni')}
                hint={t('settings.dniHint')}
                autoCapitalize="characters"
                icon={<IdCard />}
                error={fieldMessage(t, errors.dniNie)}
                {...register('dniNie')}
              />
              <Field label={t('settings.phone')} type="tel" inputMode="tel" autoComplete="tel" icon={<Phone />} error={fieldMessage(t, errors.phone)} {...register('phone')} />
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={isSubmitting} disabled={!isDirty} className="max-sm:w-full">
                {t('common.save')}
              </Button>
            </div>
          </form>
        </Card>
      </section>

      <section aria-labelledby="appearance-title">
        <SectionTitle id="appearance-title" className="mb-2.5">
          {t('settings.appearance')}
        </SectionTitle>
        <Card className="space-y-5 p-4 sm:p-5">
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('settings.theme')}</p>
            <Segmented<ThemeMode>
              label={t('settings.theme')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'system', label: t('settings.themeSystem'), icon: <Monitor /> },
                { value: 'light', label: t('settings.themeLight'), icon: <Sun /> },
                { value: 'dark', label: t('settings.themeDark'), icon: <Moon /> },
                { value: 'contrast', label: t('settings.themeContrast'), icon: <SunMedium /> },
              ]}
            />
            <p className="mt-1.5 text-sm text-fg-muted">{t('settings.themeHint')}</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('settings.language')}</p>
            <Segmented
              label={t('settings.language')}
              value={i18n.resolvedLanguage ?? 'es'}
              onChange={changeLanguage}
              options={SUPPORTED_LOCALES.map((l) => ({ value: l, label: LANG_LABEL[l]! }))}
            />
          </div>
        </Card>
      </section>

      <PushSettings />
      <EmailPrefsSettings />
      <PasswordSettings />
      <KioskPinSettings />
      <SessionsSettings />
      <PrivacySettings />

      <section aria-labelledby="session-title">
        <SectionTitle id="session-title" className="mb-2.5">
          {t('settings.session')}
        </SectionTitle>
        <Button variant="secondary" block size="lg" className="text-danger-text" onClick={() => void logout()} icon={<LogOut className="size-5" />}>
          {t('settings.logout')}
        </Button>
      </section>
    </div>
  );
}
