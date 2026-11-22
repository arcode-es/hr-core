import type { DocumentDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, CheckCheck, Download, IdCard, PenLine, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { docState, formatBytes, STATE_TONE } from '../documents/meta';
import { PdfViewer } from '../documents/PdfViewer';
import { SignaturePad, type SignaturePadHandle } from '../documents/SignaturePad';
import { api, apiBlob } from '../lib/api';
import { saveBlob } from '../lib/download';
import { errorMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/Page';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';

const refresh = (): void => void queryClient.invalidateQueries({ queryKey: ['documents'] });

function SignSheet({ doc, open, onClose }: { doc: DocumentDto; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useSession((s) => s.user)!;
  const pad = useRef<SignaturePadHandle>(null);
  const [ready, setReady] = useState(false);

  const sign = useMutation({
    mutationFn: () => api<DocumentDto>(`/documents/${doc.id}/sign`, { method: 'POST', body: pad.current!.result() }),
    onSuccess: () => {
      refresh();
      toast.success(t('documents.signed'));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  return (
    <Sheet open={open} onClose={onClose} title={t('documents.signTitle')} description={doc.title} className="sm:max-w-lg">
      {!me.dniNie ? (
        <div className="space-y-4 pt-1">
          <p className="flex gap-2.5 rounded-2xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">
            <IdCard className="mt-0.5 size-4 shrink-0" />
            {t('documents.dniNeeded')}
          </p>
          <Link to="/settings" className="block">
            <Button size="lg" block>
              {t('documents.goToProfile')}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {open && <SignaturePad ref={pad} onChange={setReady} />}
          <p className="flex gap-2.5 text-sm text-fg-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            {t('documents.signLegal', { name: me.fullName, dni: me.dniNie })}
          </p>
          <Button size="lg" block disabled={!ready} loading={sign.isPending} onClick={() => sign.mutate()} icon={<PenLine className="size-5" />}>
            {t('documents.signConfirm')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function DocumentView() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const workspaceId = useSession((s) => s.workspaceId);
  const me = useSession((s) => s.user)!;
  const ws = useWorkspace();
  const [version, setVersion] = useState<'signed' | 'original'>('signed');
  const [signing, setSigning] = useState(false);

  const doc = useQuery({ queryKey: ['documents', workspaceId, 'one', id], queryFn: () => api<DocumentDto>(`/documents/${id}`), retry: false });
  const d = doc.data;
  const which = d?.status === 'SIGNED' && version === 'signed' ? 'signed' : 'original';
  const file = useQuery({
    queryKey: ['documents', workspaceId, 'file', id, which],
    queryFn: async () => {
      const blob = await apiBlob(`/documents/${id}/content/${which}`);
      return { blob, buffer: await blob.arrayBuffer() };
    },
    enabled: !!d,
    staleTime: Infinity,
    gcTime: 60_000,
  });

  // Abrir un documento a firmar lo marca como visto en el servidor: refresca el estado en las listas.
  useEffect(() => {
    if (file.isSuccess && d?.status === 'SENT' && d.requiresSignature && d.recipient.id === me.id) refresh();
  }, [file.isSuccess, d?.status, d?.requiresSignature, d?.recipient.id, me.id]);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const isPdf = which === 'signed' || d?.mimeType === 'application/pdf';
  useEffect(() => {
    if (!file.data || isPdf) return setImageUrl(null);
    const url = URL.createObjectURL(file.data.blob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file.data, isPdf]);

  const acknowledge = useMutation({
    mutationFn: () => api<DocumentDto>(`/documents/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => {
      refresh();
      toast.success(t('documents.acknowledged'));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success(t('documents.withdrawn'));
      void navigate('/documents');
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  const download = (): void => {
    if (!file.data || !d) return;
    saveBlob(file.data.blob, which === 'signed' ? `${d.fileName.replace(/\.[^.]+$/, '')}-firmado.pdf` : d.fileName);
  };

  if (doc.isPending) {
    return (
      <div className="flex justify-center py-24 text-fg-subtle">
        <Spinner className="size-7" />
      </div>
    );
  }
  if (!d) {
    return (
      <Card>
        <EmptyState
          icon={<Trash2 />}
          title={t('documents.notFoundTitle')}
          body={t('documents.notFoundBody')}
          action={
            <Link to="/documents">
              <Button variant="secondary">{t('common.back')}</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const state = docState(d);
  const mine = d.recipient.id === me.id;
  const canWithdraw = d.status !== 'SIGNED' && (d.sender.id === me.id || (ws.kind === 'organization' && ws.role === 'ADMIN'));
  const when = (iso: string): string => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const facts: [string, string | null][] = [
    [t('documents.from'), d.sender.fullName],
    [t('documents.to'), d.recipient.fullName],
    [t('documents.sentAt'), when(d.createdAt)],
    [t('documents.readAt'), d.viewedAt && when(d.viewedAt)],
    [t('documents.signedAt'), d.signedAt && when(d.signedAt)],
    [t('documents.file'), `${d.fileName} · ${formatBytes(d.sizeBytes, lang)}`],
  ];

  return (
    <div className="animate-page space-y-4">
      <div className="flex items-start gap-2">
        <Link
          to="/documents"
          aria-label={t('common.back')}
          className="focus-ring -ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-xl leading-tight font-bold tracking-tight">{d.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{t(`documents.cat_${d.category}`)}</p>
        </div>
        <Badge tone={STATE_TONE[state]} className="mt-1.5">
          {t(mine ? `documents.state_${state}` : `documents.sentState_${state}`)}
        </Badge>
      </div>

      {d.status === 'SIGNED' && (
        <Segmented
          label={t('documents.version')}
          value={version}
          onChange={setVersion}
          options={[
            { value: 'signed', label: t('documents.versionSigned'), icon: <BadgeCheck /> },
            { value: 'original', label: t('documents.versionOriginal') },
          ]}
        />
      )}

      <div className="rounded-card bg-surface-2/60 p-2 sm:p-3">
        {file.isPending ? (
          <div className="flex h-64 items-center justify-center text-fg-subtle">
            <Spinner className="size-7" />
          </div>
        ) : file.isError ? (
          <p className="py-10 text-center text-sm text-fg-muted">{errorMessage(t, file.error)}</p>
        ) : isPdf ? (
          <PdfViewer data={file.data.buffer} />
        ) : (
          imageUrl && <img src={imageUrl} alt={d.title} className="edge mx-auto block max-w-full rounded-xl bg-white" />
        )}
      </div>

      <Card>
        <dl className="divide-y divide-border text-sm">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="shrink-0 text-fg-muted">{k}</dt>
                <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
              </div>
            ))}
          <div className="px-4 py-2.5">
            <dt className="text-fg-muted">{t('documents.hash')}</dt>
            <dd className="mt-0.5 font-mono text-xs break-all text-fg-muted">{d.sha256}</dd>
          </div>
          {d.audit && (
            <div className="flex gap-2.5 bg-success-soft px-4 py-3 text-success-text">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <p className="text-sm font-medium">{t('documents.auditLine', { name: d.audit.signerName, dni: d.audit.signerDni, ip: d.audit.ip ?? '—' })}</p>
            </div>
          )}
        </dl>
      </Card>

      {/* Acción principal fija abajo, al alcance del pulgar. */}
      <div className="sticky bottom-20 z-20 flex gap-2.5 lg:bottom-4">
        {mine && state === 'toSign' && (
          <Button size="lg" block className="shadow-pop" onClick={() => setSigning(true)} icon={<PenLine className="size-5" />}>
            {t('documents.signAction')}
          </Button>
        )}
        {mine && state === 'toRead' && (
          <Button size="lg" block className="shadow-pop" loading={acknowledge.isPending} onClick={() => acknowledge.mutate()} icon={<CheckCheck className="size-5" />}>
            {t('documents.acknowledge')}
          </Button>
        )}
        <Button
          variant="secondary"
          size="lg"
          block={!(mine && (state === 'toSign' || state === 'toRead'))}
          className="shadow-pop"
          disabled={!file.data}
          onClick={download}
          icon={<Download className="size-5" />}
          aria-label={t('documents.download')}
        >
          {!(mine && (state === 'toSign' || state === 'toRead')) && t('documents.download')}
        </Button>
        {canWithdraw && (
          <Button variant="secondary" size="lg" className="text-danger-text shadow-pop" loading={remove.isPending} onClick={() => remove.mutate()} aria-label={t('documents.withdraw')} icon={<Trash2 className="size-5" />} />
        )}
      </div>

      <SignSheet doc={d} open={signing} onClose={() => setSigning(false)} />
    </div>
  );
}
