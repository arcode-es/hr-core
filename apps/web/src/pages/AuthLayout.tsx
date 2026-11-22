import { Camera, FileSignature, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DemoBanner } from '../app/DemoBanner';
import { Logo, LogoMark } from '../ui/Logo';
import { Particles } from '../ui/Particles';
import { LegalLinks } from './Legal';

/** Pantallas sin sesión: formulario a un lado y, en escritorio, panel de marca al otro. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation();
  const points = [
    { icon: MapPin, text: t('auth.point1') },
    { icon: Camera, text: t('auth.point2') },
    { icon: FileSignature, text: t('auth.point3') },
  ];
  return (
    <div className="flex min-h-dvh">
      <aside className="relative hidden w-[46%] max-w-xl flex-col justify-between overflow-hidden bg-[#000409] p-12 text-white lg:flex">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_100%,#06224f_0%,transparent_70%)]" />
        <Particles shapes={['dome']} centerY={0.78} scale={1.25} className="opacity-80" />
        <span className="relative inline-flex items-center gap-2.5 text-[17px] font-bold tracking-tight">
          <LogoMark className="[--accent:#6db7ff]" />
          HR-Core
        </span>
        <div className="relative">
          <h2 className="text-4xl leading-[1.1] font-bold tracking-tight text-balance">{t('auth.heroTitle')}</h2>
          <p className="mt-4 max-w-md text-lg text-white/70">{t('auth.heroSubtitle')}</p>
          <ul className="mt-10 space-y-4">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3.5 font-medium">
                <span className="flex size-10 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/15 backdrop-blur">
                  <Icon className="size-5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/45">© {new Date().getFullYear()} HR-Core</p>
      </aside>

      <main className="flex flex-1 flex-col">
        <DemoBanner />
        <div className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-10">
        <div className="animate-page mx-auto w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-[28px] leading-tight font-bold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-fg-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          {footer && <p className="mt-6 text-center text-sm text-fg-muted">{footer}</p>}
          <LegalLinks className="mt-10" />
        </div>
        </div>
      </main>
    </div>
  );
}
