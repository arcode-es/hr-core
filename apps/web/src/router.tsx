import { useTranslation } from 'react-i18next';
import { createBrowserRouter, Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { AppShell } from './app/AppShell';
import { Absences } from './pages/Absences';
import { Alerts } from './pages/Alerts';
import { NoAccess, VerifyEmail } from './pages/Access';
import { Clock } from './pages/Clock';
import { Company } from './pages/Company';
import { DocumentView } from './pages/DocumentView';
import { Documents } from './pages/Documents';
import { Expenses } from './pages/Expenses';
import { Go } from './pages/Go';
import { Home } from './pages/Home';
import { Invite } from './pages/Invite';
import { Kiosk } from './pages/Kiosk';
import { Legal } from './pages/Legal';
import { LocationEditor } from './pages/LocationEditor';
import { Locations } from './pages/Locations';
import { Login } from './pages/Login';
import { Payroll } from './pages/Payroll';
import { More } from './pages/More';
import { ForgotPassword, ResetPassword } from './pages/PasswordReset';
import { Register } from './pages/Register';
import { Reports } from './pages/Reports';
import { Schedule } from './pages/Schedule';
import { Settings } from './pages/Settings';
import { Sites } from './pages/Sites';
import { Team } from './pages/Team';
import { Timesheets } from './pages/Timesheets';
import { useMeta } from './stores/meta';
import { useSession } from './stores/session';
import { LogoMark } from './ui/Logo';
import { Spinner } from './ui/Spinner';

function Splash() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5" role="status" aria-label={t('common.loading')}>
      <LogoMark className="size-14" />
      <Spinner className="text-fg-subtle" />
    </div>
  );
}

/**
 * Ruta donde vive la app, con barra final (p. ej. /HR-core/; '/' en la raíz del dominio). Con la barra, el
 * inicio es /HR-core/ y no /HR-core, que quedaría fuera del ámbito del service worker y no abriría sin red.
 */
const BASENAME = import.meta.env.BASE_URL;

/** Solo rutas internas: evita redirecciones abiertas a través de ?next=. */
const safeNext = (next: string | null): string => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

function RequireAuth() {
  const status = useSession((s) => s.status);
  const signedOut = useSession((s) => s.signedOut);
  const workspaces = useSession((s) => s.workspaces);
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'guest') {
    // Volver a donde estaba solo tiene sentido si la sesión caducó. Tras cerrarla a
    // propósito (móvil compartido), quien entre después empieza en el inicio.
    const next = signedOut || location.pathname === '/' ? '' : `?next=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={`/login${next}`} replace />;
  }
  // Sin espacio personal (demo, servidor de un cliente) y sin ninguna empresa activa: nada que mostrar.
  if (workspaces.length === 0) return <NoAccess />;
  return <Outlet />;
}

function GuestOnly() {
  const status = useSession((s) => s.status);
  // El acceso cambia según la instalación (demo, cliente, abierta): se espera a saberla.
  const metaReady = useMeta((s) => s.ready || s.meta !== null);
  const [params] = useSearchParams();
  if (status === 'loading' || !metaReady) return <Splash />;
  if (status === 'authed') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/forgot-password', element: <ForgotPassword /> },
    ],
  },
  { path: '/invite/:token', element: <Invite /> },
  // Fuera de GuestOnly: el enlace del correo debe funcionar aunque haya una sesión abierta.
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/verify-email', element: <VerifyEmail /> },
  { path: '/legal/:page', element: <Legal /> },
  // Tablet compartida: sin sesión de nadie, se identifica con su propio token.
  { path: '/kiosk', element: <Kiosk /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Home /> },
          { path: '/clock', element: <Clock /> },
          { path: '/schedule', element: <Schedule /> },
          { path: '/expenses', element: <Expenses /> },
          { path: '/documents', element: <Documents /> },
          { path: '/documents/payroll', element: <Payroll /> },
          { path: '/documents/:id', element: <DocumentView /> },
          { path: '/locations', element: <Locations /> },
          { path: '/locations/new', element: <LocationEditor /> },
          { path: '/locations/:id', element: <LocationEditor /> },
          { path: '/go', element: <Go /> },
          { path: '/reports', element: <Reports /> },
          { path: '/team', element: <Team /> },
          { path: '/timesheets', element: <Timesheets /> },
          { path: '/absences', element: <Absences /> },
          { path: '/alerts', element: <Alerts /> },
          { path: '/sites', element: <Sites /> },
          { path: '/settings', element: <Settings /> },
          { path: '/company', element: <Company /> },
          { path: '/more', element: <More /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
], { basename: BASENAME });
