import type { DashboardDto, MemberDto } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, CalendarOff, Check, ChevronRight, ClipboardCheck, Clock as ClockIcon, FileSignature, type LucideIcon, Receipt, ShieldAlert, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { VerifyEmailBanner } from '../app/VerifyEmailBanner';
import { CreateOrganizationSheet } from '../app/WorkspaceSwitcher';
import { NAV } from '../app/nav';
import { api } from '../lib/api';
import { liveTotals, useClockStatus, useServerNow } from '../lib/clock';
import { HandoverNotes } from '../time/Handover';
import { cn } from '../lib/cn';
import { formatTime, formatTimer } from '../lib/format';
import { useMode } from '../stores/meta';
import { useSession, useWorkspace } from '../stores/session';
import { Badge } from '../ui/Badge';
import { Card, SectionTitle } from '../ui/Card';

/** Estado del fichaje de un vistazo, con acceso directo a la pantalla de fichar. */
/** Las notas de relevo sin leer también salen en el inicio: es lo primero que se abre. */
function HomeHandover() {
  const { data: view } = useClockStatus();
  return <HandoverNotes notes={view?.notes} />;
}

function ClockCard() {
  const { t, i18n } = useTranslation();
  const { data: view } = useClockStatus();
  const now = useServerNow(view?.offsetMs ?? 0, !!view && view.state !== 'IDLE');
  if (!view) return <Card className="h-[92px] animate-pulse bg-surface-2" />;

  const day = view.workday;
  const live = day ? liveTotals(day, now) : null;
  const paused = view.state === 'PAUSED';

  return (
    <Link to="/clock" className="focus-ring group block rounded-card">
      <Card className="flex items-center gap-4 p-4 transition-[translate] group-hover:-translate-y-0.5">
        <span
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-2xl',
            !day ? 'bg-accent text-accent-fg' : paused ? 'bg-warning-soft text-warning-text' : 'bg-success-soft text-success-text',
          )}
        >
          <ClockIcon className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          {day && live ? (
            <>
              <p className="text-sm font-semibold text-fg-muted">
                {paused ? t('clock.pause') : t('clock.working')} · {t('clock.since', { time: formatTime(day.startedAt, i18n.resolvedLanguage) })}
              </p>
              <p className="text-3xl leading-tight font-bold tracking-tight tabular-nums">{formatTimer(live.worked)}</p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold tracking-tight">{t('clock.homeIdle')}</p>
              <p className="text-sm text-fg-muted">{t('clock.homeIdleHint')}</p>
            </>
          )}
        </div>
        <ArrowRight className="size-5 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-label={t('clock.homeGo')} />
      </Card>
    </Link>
  );
}

/** Lo pendiente de un vistazo: mi próximo turno y mis documentos y, si superviso, el pulso del equipo. */
function Overview() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const { data } = useQuery({ queryKey: ['dashboard', workspaceId], queryFn: () => api<DashboardDto>('/dashboard'), refetchInterval: 60_000 });
  if (!data) return null;

  const { me, team } = data;
  const shift = me.nextShift;
  const shiftDay = shift && new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(shift.plannedStart));
  const tiles: { to: string; icon: LucideIcon; label: string; value: string; alert: boolean }[] = team
    ? [
        { to: '/timesheets', icon: Users, label: t('home.teamClockedIn'), value: `${team.clockedIn + team.onBreak}/${team.members}`, alert: false },
        { to: '/timesheets', icon: ClipboardCheck, label: t('home.teamPendingTime'), value: String(team.pendingTimeEntries), alert: team.pendingTimeEntries > 0 },
        { to: '/expenses', icon: Receipt, label: t('home.teamPendingExpenses'), value: String(team.pendingExpenses), alert: team.pendingExpenses > 0 },
        { to: '/documents', icon: FileSignature, label: t('home.teamDocuments'), value: String(team.documentsAwaiting), alert: false },
        { to: '/absences', icon: CalendarOff, label: t('home.teamPendingAbsences'), value: String(team.pendingAbsences), alert: team.pendingAbsences > 0 },
        { to: '/absences', icon: CalendarOff, label: t('home.teamAbsentToday'), value: String(team.absentToday), alert: false },
        { to: '/alerts', icon: ShieldAlert, label: t('home.teamAlerts'), value: String(team.openAlerts), alert: team.openAlerts > 0 },
      ]
    : [];

  return (
    <>
      {(shift || me.documentsPending > 0) && (
        <div className="space-y-2.5">
          {me.documentsPending > 0 && (
            <Link to="/documents" className="focus-ring edge flex items-center gap-3 rounded-2xl bg-warning-soft px-4 py-3 text-warning-text">
              <FileSignature className="size-5 shrink-0" />
              <span className="flex-1 text-sm font-semibold">{t('home.documentsPending', { count: me.documentsPending })}</span>
              <ArrowRight className="size-4" />
            </Link>
          )}
          {shift && (
            <Link to="/schedule" className="focus-ring edge flex items-center gap-3 rounded-2xl bg-surface px-4 py-3">
              <CalendarDays className="size-5 shrink-0 text-accent-text" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-fg-muted">{t('home.nextShift')}</span>
                <span className="block truncate text-sm font-semibold first-letter:uppercase">
                  {shiftDay} · {formatTime(shift.plannedStart, lang)} – {formatTime(shift.plannedEnd, lang)}
                  {shift.locationName && ` · ${shift.locationName}`}
                </span>
              </span>
              <ArrowRight className="size-4 text-fg-subtle" />
            </Link>
          )}
        </div>
      )}

      {team && (
        <section aria-labelledby="team-title">
          <SectionTitle id="team-title" className="mb-2.5">
            {t('home.teamTitle')}
          </SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map((tile) => (
              <Link key={tile.label} to={tile.to} className="focus-ring group rounded-card">
                <Card className={cn('h-full p-4 transition-[translate] group-hover:-translate-y-0.5', tile.alert && 'bg-warning-soft')}>
                  <tile.icon className={cn('size-5', tile.alert ? 'text-warning-text' : 'text-fg-muted')} />
                  <p className={cn('mt-2 text-3xl leading-none font-bold tracking-tight tabular-nums', tile.alert && 'text-warning-text')}>{tile.value}</p>
                  <p className={cn('mt-1.5 text-sm leading-snug', tile.alert ? 'font-semibold text-warning-text' : 'text-fg-muted')}>{tile.label}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

interface Step {
  key: string;
  title: string;
  desc?: string;
  done: boolean;
  to?: string;
  onClick?: () => void;
}

export function Home() {
  const { t, i18n } = useTranslation();
  const { user, workspaces } = useSession();
  const ws = useWorkspace();
  const [creating, setCreating] = useState(false);

  const hour = new Date().getHours();
  const greeting = hour < 6 || hour >= 21 ? t('home.evening') : hour < 14 ? t('home.morning') : t('home.afternoon');
  const today = new Intl.DateTimeFormat(i18n.resolvedLanguage, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(),
  );

  const isAdmin = ws.kind === 'organization' && ws.role === 'ADMIN';
  const orgId = ws.kind === 'organization' ? ws.organizationId : null;
  // Misma clave que la página de Equipo: comparten caché.
  const members = useQuery({ queryKey: ['members', orgId], queryFn: () => api<MemberDto[]>('/members'), enabled: isAdmin });
  const hasTeam = (members.data?.length ?? 0) > 1;

  const hasOrg = workspaces.some((w) => w.kind === 'organization');
  const open = useMode() === 'open';
  const steps: Step[] = [
    { key: 'account', title: t('home.stepAccount'), done: true },
    { key: 'profile', title: t('home.stepProfile'), desc: t('home.stepProfileDesc'), done: !!user?.dniNie, to: '/settings' },
    ...(isAdmin
      ? [{ key: 'invite', title: t('home.stepInvite'), desc: t('home.stepInviteDesc'), done: hasTeam, to: '/team' }]
      : // Crear o unirse a una empresa solo tiene sentido donde hay espacio personal.
        open
        ? [{ key: 'org', title: t('home.stepOrg'), desc: t('home.stepOrgDesc'), done: hasOrg, onClick: () => setCreating(true) }]
        : []),
  ];
  const done = steps.filter((s) => s.done).length;

  const modules = [
    { ...NAV.schedule, desc: t('home.scheduleDesc'), phase: 0 },
    { ...NAV.expenses, desc: t('home.expensesDesc'), phase: 0 },
    { ...NAV.documents, desc: t('home.documentsDesc'), phase: 0 },
    { ...NAV.locations, desc: t('home.locationsDesc'), phase: 0 },
  ];

  return (
    <div className="animate-page space-y-7">
      <header>
        <p className="text-sm font-medium text-fg-muted first-letter:uppercase">{today}</p>
        <h1 className="mt-0.5 text-[28px] leading-tight font-bold tracking-tight">
          {greeting}, {user?.fullName.split(' ')[0]}
        </h1>
      </header>

      {open && user && !user.emailVerified && <VerifyEmailBanner email={user.email} />}
      <HomeHandover />
      <ClockCard />
      <Overview />

      {done < steps.length && !(isAdmin && members.isPending) && (
        <section aria-labelledby="start-title">
          <div className="mb-2.5 flex items-center justify-between">
            <SectionTitle id="start-title">{t('home.gettingStarted')}</SectionTitle>
            <span className="text-xs font-medium text-fg-muted">{t('home.progress', { done, total: steps.length })}</span>
          </div>
          <Card className="overflow-hidden">
            <div
              className="h-1.5 bg-surface-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={done}
              aria-labelledby="start-title"
            >
              <div className="h-full rounded-r-full bg-accent transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
            </div>
            <ul>
              {steps.map((s, i) => {
                const inner = (
                  <>
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        s.done ? 'bg-success text-white' : 'edge bg-surface text-fg-muted',
                      )}
                    >
                      {s.done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block font-semibold', s.done && 'text-fg-muted line-through decoration-fg-subtle')}>
                        {s.title}
                      </span>
                      {!s.done && s.desc && <span className="block text-sm text-fg-muted">{s.desc}</span>}
                    </span>
                    {!s.done && <ChevronRight className="size-5 shrink-0 text-fg-subtle" />}
                  </>
                );
                const cls = cn('flex w-full items-center gap-3.5 px-4 py-3.5 text-left', i > 0 && 'edge-t');
                return (
                  <li key={s.key}>
                    {s.done ? (
                      <div className={cls}>{inner}</div>
                    ) : s.to ? (
                      <Link to={s.to} className={cn(cls, 'focus-ring transition-colors hover:bg-surface-2')}>
                        {inner}
                      </Link>
                    ) : (
                      <button type="button" onClick={s.onClick} className={cn(cls, 'focus-ring transition-colors hover:bg-surface-2')}>
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}

      <section aria-labelledby="modules-title">
        <SectionTitle id="modules-title" className="mb-2.5">
          {t('home.modules')}
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          {modules.map((m) => (
            <Link key={m.key} to={m.to} className="focus-ring group rounded-card">
              <Card className="flex h-full flex-col p-4 transition-[translate,box-shadow] group-hover:-translate-y-0.5">
                <div className="flex items-start justify-between">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
                    <m.icon className="size-[22px]" />
                  </span>
                  <ArrowRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                </div>
                <h3 className="mt-3.5 font-bold tracking-tight">{t(`nav.${m.key}`)}</h3>
                <p className="mt-0.5 flex-1 text-sm leading-snug text-fg-muted">{m.desc}</p>
                {m.phase > 0 && <Badge className="mt-3 self-start">{t('common.soon')}</Badge>}
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <CreateOrganizationSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
