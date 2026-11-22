import { MailWarning } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';

/** Instalación abierta: recuerda confirmar el correo, que hace falta para crear empresas o invitar. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const resend = async (): Promise<void> => {
    setSending(true);
    try {
      await api('/auth/verify-email/resend', { method: 'POST' });
      toast.success(t('verify.resent'));
    } catch (e) {
      toast.error(errorMessage(t, e));
    } finally {
      setSending(false);
    }
  };
  return (
    <section aria-labelledby="verify-title" className="flex flex-wrap items-start gap-3 rounded-2xl bg-warning-soft p-4 text-warning-text">
      <MailWarning className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 id="verify-title" className="font-semibold">
          {t('verify.bannerTitle')}
        </h2>
        <p className="mt-0.5 text-sm">{t('verify.bannerBody', { email })}</p>
      </div>
      <Button variant="secondary" size="sm" loading={sending} onClick={() => void resend()} className="max-sm:w-full">
        {t('verify.resend')}
      </Button>
    </section>
  );
}
