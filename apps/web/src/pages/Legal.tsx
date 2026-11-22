import { APP_NAME } from '@hr/shared';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { DemoBanner } from '../app/DemoBanner';
import { LEGAL_PAGES, type LegalPage, legalText } from '../legal/texts';
import { useMeta } from '../stores/meta';
import { useSession } from '../stores/session';
import { Logo } from '../ui/Logo';

/** Enlaces a las páginas legales: en el acceso, en Ajustes y en las propias páginas. */
export function LegalLinks({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('legal.nav')} className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm ${className}`}>
      {LEGAL_PAGES.map((p) => (
        <Link key={p} to={`/legal/${p}`} className="font-medium text-fg-muted hover:text-fg hover:underline">
          {t(`legal.${p}`)}
        </Link>
      ))}
    </nav>
  );
}

/** Política de privacidad, aviso legal y cookies. Públicas: se pueden leer sin cuenta. */
export function Legal() {
  const { t, i18n } = useTranslation();
  const { page = '' } = useParams();
  const meta = useMeta((s) => s.meta);
  const ready = useMeta((s) => s.ready || s.meta !== null);
  const authed = useSession((s) => s.status === 'authed');
  if (!ready) return null;
  if (!LEGAL_PAGES.includes(page as LegalPage)) return <Navigate to="/legal/privacidad" replace />;
  const text = legalText(i18n.resolvedLanguage ?? 'es', page as LegalPage, { legal: meta?.legal ?? null, mode: meta?.mode ?? 'open', app: meta?.appName ?? APP_NAME });

  return (
    <div className="min-h-dvh">
      <DemoBanner />
      <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-8 flex items-center justify-between gap-3">
          <Logo />
          <Link to={authed ? '/settings' : '/login'} className="focus-ring inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-accent-text hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            {authed ? t('legal.backSettings') : t('legal.backLogin')}
          </Link>
        </div>
        <article className="animate-page">
          <h1 className="text-[28px] leading-tight font-bold tracking-tight">{text.title}</h1>
          <p className="mt-3 text-fg-muted">{text.intro}</p>
          {!meta?.legal && (
            <p role="note" className="mt-5 flex gap-2.5 rounded-2xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('legal.missing')}
            </p>
          )}
          {text.sections.map((s) => (
            <section key={s.title} className="mt-8">
              <h2 className="text-lg font-bold tracking-tight">{s.title}</h2>
              {s.paragraphs?.map((p) => (
                <p key={p} className="mt-2.5 leading-relaxed">
                  {p}
                </p>
              ))}
              {s.items && (
                <ul className="mt-2.5 list-disc space-y-1.5 pl-5 leading-relaxed marker:text-fg-subtle">
                  {s.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </article>
        <LegalLinks className="edge-t mt-12 pt-6" />
      </div>
    </div>
  );
}
