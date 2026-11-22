import type { InvitationPreview, WorkspaceSummary } from '@hr/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Logo } from '../ui/Logo';
import { EmptyState } from '../ui/Page';
import { Spinner } from '../ui/Spinner';

/** Página pública del enlace de invitación. Funciona con y sin sesión iniciada. */
export function Invite() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { status, user, logout, reload, setWorkspace } = useSession();
  const [joining, setJoining] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InvitationPreview>(`/invite/${encodeURIComponent(token)}`, { auth: false }),
    retry: false,
  });

  const join = async (): Promise<void> => {
    setJoining(true);
    try {
      const ws = await api<Extract<WorkspaceSummary, { kind: 'organization' }>>(
        `/invite/${encodeURIComponent(token)}/accept`,
        { method: 'POST' },
      );
      await reload();
      setWorkspace(ws.organizationId);
      queryClient.clear();
      toast.success(t('invite.joined', { org: ws.name }));
      void navigate('/', { replace: true });
    } catch (e) {
      toast.error(errorMessage(t, e));
      setJoining(false);
    }
  };

  const next = `?next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(data?.email ?? '')}${data?.fullName ? `&name=${encodeURIComponent(data.fullName)}` : ''}`;
  const sameAccount = user && data && user.email.toLowerCase() === data.email.toLowerCase();

  let body;
  if (isPending || status === 'loading') {
    body = (
      <div className="flex justify-center py-16 text-fg-subtle">
        <Spinner className="size-7" />
      </div>
    );
  } else if (isError || !data) {
    body = <EmptyState icon={<CircleAlert />} title={t('invite.invalidTitle')} body={t('invite.invalidBody')} />;
  } else if (data.status !== 'valid') {
    body = (
      <EmptyState
        icon={<CircleAlert />}
        title={t(`invite.${data.status}Title`)}
        body={t(`invite.${data.status}Body`)}
        action={
          <Link to="/">
            <Button variant="secondary">{t('invite.goHome')}</Button>
          </Link>
        }
      />
    );
  } else {
    body = (
      <div className="p-6 text-center">
        <Avatar name={data.organizationName} shape="square" size="lg" className="mx-auto" />
        <p className="mt-4 text-xs font-semibold tracking-wider text-fg-subtle uppercase">{t('invite.title')}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{data.organizationName}</h1>
        <p className="mt-2 text-fg-muted">
          {t('invite.body', { by: data.invitedBy, org: data.organizationName, role: t(`roles.${data.role}`) })}
        </p>

        <div className="mt-6 space-y-2.5">
          {status === 'authed' && sameAccount && (
            <Button size="lg" block loading={joining} onClick={join} icon={<MailCheck className="size-5" />}>
              {t('invite.join', { org: data.organizationName })}
            </Button>
          )}
          {status === 'authed' && !sameAccount && (
            <>
              <p className="rounded-control bg-warning-soft px-3.5 py-3 text-sm font-medium text-warning-text">
                {t('invite.wrongAccount', { email: data.email, current: user?.email })}
              </p>
              <Button variant="secondary" block onClick={() => void logout()}>
                {t('invite.switchAccount')}
              </Button>
            </>
          )}
          {status === 'guest' && (
            <>
              <p className="pb-1 text-sm text-fg-muted">{t('invite.needAccount', { email: data.email })}</p>
              <Link to={`/register${next}`} className="block">
                <Button size="lg" block>
                  {t('auth.register')}
                </Button>
              </Link>
              <Link to={`/login${next}`} className="block">
                <Button variant="secondary" size="lg" block>
                  {t('auth.login')}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Logo className="mb-8" />
      <Card className="animate-page w-full max-w-sm">{body}</Card>
    </div>
  );
}
