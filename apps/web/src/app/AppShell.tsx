import { Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';
import { cn } from '../lib/cn';
import { usePendingReviews } from '../pages/Timesheets';
import { useSession, useWorkspace } from '../stores/session';
import { Avatar } from '../ui/Avatar';
import { BrandLogo, useBrandTheme } from '../ui/BrandLogo';
import { DemoBanner } from './DemoBanner';
import { NotificationsBell } from './Notifications';
import { OfflineBanner } from './OfflineBanner';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { GENERAL, MANAGEMENT, NAV, type NavItem, visible } from './nav';

function SideLink({ item, count = 0 }: { item: NavItem; count?: number }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'focus-ring flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent-soft font-semibold text-accent-text'
            : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        )
      }
    >
      <Icon className="size-[18px]" />
      <span className="flex-1">{t(`nav.${item.key}`)}</span>
      {count > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-bold text-white tabular-nums">
          {count}
        </span>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user)!;
  const ws = useWorkspace();
  const role = ws.kind === 'organization' ? ws.role : null;
  const management = MANAGEMENT.filter((i) => visible(i, role));
  const pending = usePendingReviews().data?.length ?? 0;

  return (
    <aside className="edge-r sticky top-0 hidden h-dvh w-[272px] shrink-0 flex-col gap-5 bg-surface p-4 lg:flex">
      <div className="flex items-center justify-between pt-1 pr-1 pl-2">
        <BrandLogo />
        <NotificationsBell />
      </div>
      <WorkspaceSwitcher />
      <nav aria-label={t('nav.main')} className="flex flex-1 flex-col gap-5 overflow-y-auto">
        <div className="space-y-0.5">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
            {t('nav.general')}
          </p>
          {GENERAL.map((i) => (
            <SideLink key={i.key} item={i} />
          ))}
        </div>
        {management.length > 0 && (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
              {t('nav.management')}
            </p>
            {management.map((i) => (
              <SideLink key={i.key} item={i} count={i.key === 'timesheets' ? pending : 0} />
            ))}
          </div>
        )}
      </nav>
      <NavLink
        to="/settings"
        className={({ isActive }) =>
          cn(
            'focus-ring flex items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-surface-2',
            isActive && 'bg-surface-2',
          )
        }
      >
        <Avatar name={user.fullName} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{user.fullName}</span>
          <span className="block truncate text-xs text-fg-muted">{user.email}</span>
        </span>
        <NAV.settings.icon className="size-4 text-fg-subtle" aria-label={t('nav.settings')} />
      </NavLink>
    </aside>
  );
}

/** Barra inferior: cuatro destinos y «Fichar» destacado en el centro, al alcance del pulgar. */
function BottomBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const pending = usePendingReviews().data?.length ?? 0;
  const moreActive = ['/more', '/documents', '/reports', '/team', '/timesheets', '/locations', '/settings'].some((p) => pathname.startsWith(p));

  const tab = (to: string, label: string, Icon: NavItem['icon'], forceActive?: boolean) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'focus-ring flex h-full flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors',
          (forceActive ?? isActive) ? 'text-accent-text' : 'text-fg-subtle',
        )
      }
    >
      <span className="relative">
        <Icon className="size-[22px]" />
        {to === '/more' && pending > 0 && <span className="absolute -top-0.5 -right-1.5 size-2.5 rounded-full bg-warning ring-2 ring-surface" />}
      </span>
      {label}
    </NavLink>
  );

  return (
    <nav
      aria-label={t('nav.main')}
      className="edge-t fixed inset-x-0 bottom-0 z-40 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <div className="mx-auto flex h-16 max-w-lg items-stretch px-2">
        {tab('/', t('nav.home'), NAV.home.icon)}
        {tab('/schedule', t('nav.schedule'), NAV.schedule.icon)}
        <div className="flex flex-1 items-start justify-center">
          <NavLink
            to="/clock"
            aria-label={t('nav.clock')}
            className={({ isActive }) =>
              cn(
                'focus-ring -mt-5 flex size-[60px] flex-col items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg ring-4 ring-bg transition-transform active:scale-95',
                isActive && 'bg-accent-hover',
              )
            }
          >
            <NAV.clock.icon className="size-6" />
            <span className="text-[10px] leading-none font-bold">{t('nav.clock')}</span>
          </NavLink>
        </div>
        {tab('/expenses', t('nav.expenses'), NAV.expenses.icon)}
        {tab('/more', t('nav.more'), Ellipsis, moreActive)}
      </div>
    </nav>
  );
}

export function AppShell() {
  const user = useSession((s) => s.user)!;
  useBrandTheme();
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <header className="edge-b sticky top-0 z-30 flex h-14 items-center justify-between gap-2 bg-bg/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
          <WorkspaceSwitcher compact />
          <span className="flex items-center gap-1">
            <NotificationsBell />
            <NavLink to="/settings" className="focus-ring rounded-full" aria-label={user.fullName}>
              <Avatar name={user.fullName} size="sm" />
            </NavLink>
          </span>
        </header>
        <OfflineBanner />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-5 pb-28 lg:px-8 lg:pt-8 lg:pb-10">
          <Outlet />
        </main>
      </div>
      <BottomBar />
    </div>
  );
}
