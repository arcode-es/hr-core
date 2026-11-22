import type { DocumentDto } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Banknote, ChevronDown, ChevronRight, ClipboardCheck, FileText, Inbox, Send, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DOC_ICON, docState, STATE_TONE } from '../documents/meta';
import { SendDocumentSheet } from '../documents/SendSheet';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { toast } from '../stores/toast';
import { Sheet } from '../ui/Sheet';
import { selectClass } from '../ui/Switch';
import { cn } from '../lib/cn';
import { useSession, useWorkspace } from '../stores/session';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState, PageHeader } from '../ui/Page';
import { Segmented } from '../ui/Segmented';
import { Spinner } from '../ui/Spinner';

function useDocuments(box: 'inbox' | 'sent', enabled = true) {
  const workspaceId = useSession((s) => s.workspaceId);
  return useQuery({ queryKey: ['documents', workspaceId, box], queryFn: () => api<DocumentDto[]>(`/documents/${box}`), enabled });
}

const shortDate = (iso: string, lang: string | undefined): string => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(iso));
const dueLabel = (date: string, lang: string | undefined): string =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** Fecha límite de un documento: «Vencido» en rojo, o «Vence el…» mientras siga pendiente. */
function Due({ doc }: { doc: DocumentDto }) {
  const { t, i18n } = useTranslation();
  const state = docState(doc);
  if (!doc.dueDate || (state !== 'toSign' && state !== 'toRead')) return null;
  return doc.overdue ? <Badge tone="danger">{t('documents.overdue')}</Badge> : <Badge tone="warning">{t('documents.dueOn', { date: dueLabel(doc.dueDate, i18n.resolvedLanguage) })}</Badge>;
}

function DocIcon({ doc }: { doc: DocumentDto }) {
  const Icon = DOC_ICON[doc.category];
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
      <Icon className="size-5" />
    </span>
  );
}

function InboxList() {
  const { t, i18n } = useTranslation();
  const { data, isPending } = useDocuments('inbox');
  if (isPending) {
    return (
      <Card className="flex justify-center py-14 text-fg-subtle">
        <Spinner className="size-6" />
      </Card>
    );
  }
  if (!data?.length) {
    return (
      <Card>
        <EmptyState icon={<Inbox />} title={t('documents.inboxEmptyTitle')} body={t('documents.inboxEmptyBody')} />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul>
        {data.map((d, i) => {
          const state = docState(d);
          const pending = state === 'toSign' || state === 'toRead';
          return (
            <li key={d.id} className={cn(i > 0 && 'edge-t')}>
              <Link to={`/documents/${d.id}`} className="focus-ring flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                <DocIcon doc={d} />
                <span className="min-w-0 flex-1">
                  <span className={cn('line-clamp-2 block leading-snug', pending ? 'font-bold' : 'font-medium')}>{d.title}</span>
                  <span className="block truncate text-sm text-fg-muted">
                    {t(`documents.cat_${d.category}`)} · {d.sender.fullName} · {shortDate(d.createdAt, i18n.resolvedLanguage)}
                  </span>
                  {/* La fecha límite va bajo el título: así el título no se recorta en el móvil. */}
                  {d.dueDate && (state === 'toSign' || state === 'toRead') && (
                    <span className="mt-1 flex">
                      <Due doc={d} />
                    </span>
                  )}
                </span>
                <Badge tone={STATE_TONE[state]}>{t(`documents.state_${state}`)}</Badge>
                <ChevronRight className="size-5 shrink-0 text-fg-subtle" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Enviados, agrupados por envío: un mismo archivo a varias personas se sigue como una sola cosa. */
function SentList() {
  const { t, i18n } = useTranslation();
  const { data, isPending } = useDocuments('sent');
  const [open, setOpen] = useState<string | null>(null);

  if (isPending) {
    return (
      <Card className="flex justify-center py-14 text-fg-subtle">
        <Spinner className="size-6" />
      </Card>
    );
  }
  if (!data?.length) {
    return (
      <Card>
        <EmptyState icon={<Send />} title={t('documents.sentEmptyTitle')} body={t('documents.sentEmptyBody')} />
      </Card>
    );
  }
  const batches = new Map<string, DocumentDto[]>();
  for (const d of data) {
    const key = d.batchId ?? d.id;
    const list = batches.get(key);
    if (list) list.push(d);
    else batches.set(key, [d]);
  }

  return (
    <ul className="space-y-3">
      {[...batches.entries()].map(([key, docs]) => {
        const first = docs[0]!;
        const done = docs.filter((d) => (first.requiresSignature ? d.status === 'SIGNED' : d.status !== 'SENT')).length;
        const expanded = open === key;
        return (
          <li key={key}>
            <Card className="overflow-hidden">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : key)}
                className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
              >
                <DocIcon doc={first} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{first.title}</span>
                  <span className="block truncate text-sm text-fg-muted">
                    {t(`documents.cat_${first.category}`)} · {shortDate(first.createdAt, i18n.resolvedLanguage)}
                    {first.dueDate && ` · ${t('documents.dueOn', { date: dueLabel(first.dueDate, i18n.resolvedLanguage) })}`}
                  </span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2 contrast:border contrast:border-black">
                      <span className={cn('block h-full rounded-full', done === docs.length ? 'bg-success' : 'bg-accent')} style={{ width: `${(done / docs.length) * 100}%` }} />
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-fg-muted tabular-nums">
                      {t(first.requiresSignature ? 'documents.progressSigned' : 'documents.progressRead', { done, total: docs.length })}
                    </span>
                  </span>
                </span>
                <ChevronDown className={cn('size-5 shrink-0 text-fg-subtle transition-transform', expanded && 'rotate-180')} />
              </button>
              {expanded && (
                <ul className="edge-t bg-surface-2/40">
                  {docs.map((d, i) => {
                    const state = docState(d);
                    return (
                      <li key={d.id} className={cn(i > 0 && 'edge-t')}>
                        <Link to={`/documents/${d.id}`} className="focus-ring flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                          <Avatar name={d.recipient.fullName} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.recipient.fullName}</span>
                          {d.overdue && <Badge tone="danger">{t('documents.overdue')}</Badge>}
                          <Badge tone={state === 'toSign' || state === 'toRead' ? 'neutral' : STATE_TONE[state]}>{t(`documents.sentState_${state}`)}</Badge>
                          <ChevronRight className="size-4 shrink-0 text-fg-subtle" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export function Documents() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
  const [sending, setSending] = useState(false);
  const [monthly, setMonthly] = useState(false);
  const inOrg = ws.kind === 'organization';
  const inbox = useDocuments('inbox', inOrg);
  const pending = (inbox.data ?? []).filter((d) => ['toSign', 'toRead'].includes(docState(d))).length;

  if (ws.kind !== 'organization') {
    return (
      <div className="animate-page">
        <PageHeader title={t('nav.documents')} />
        <Card>
          <EmptyState icon={<FileText />} title={t('documents.personalTitle')} body={t('documents.personalBody')} />
        </Card>
      </div>
    );
  }
  const manages = ws.role === 'ADMIN' || ws.role === 'MANAGER';
  const canSend = ws.role !== 'INSPECTOR';
  const isAdmin = ws.role === 'ADMIN';

  return (
    <div className="animate-page">
      <PageHeader
        title={t('nav.documents')}
        subtitle={ws.name}
        action={
          canSend && (
            <Button onClick={() => setSending(true)} icon={<Upload className="size-[18px]" />}>
              {manages ? t('documents.sendShort') : t('documents.sendProofShort')}
            </Button>
          )
        }
      />
      {isAdmin && (
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <Link to="/documents/payroll" className="focus-ring edge flex items-center gap-2.5 rounded-2xl bg-surface px-3.5 py-3 text-sm font-semibold transition-colors hover:bg-surface-2">
            <Banknote className="size-5 shrink-0 text-accent-text" />
            {t('documents.payrollOpen')}
          </Link>
          <button
            type="button"
            onClick={() => setMonthly(true)}
            className="focus-ring edge flex items-center gap-2.5 rounded-2xl bg-surface px-3.5 py-3 text-left text-sm font-semibold transition-colors hover:bg-surface-2"
          >
            <ClipboardCheck className="size-5 shrink-0 text-accent-text" />
            {t('documents.timesheetsOpen')}
          </button>
        </div>
      )}
      <Segmented
        className="mb-4"
        label={t('nav.documents')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'inbox', label: pending ? t('documents.tabInboxCount', { count: pending }) : t('documents.tabInbox') },
          { value: 'sent', label: t('documents.tabSent') },
        ]}
      />
      {tab === 'inbox' ? <InboxList /> : <SentList />}
      <SendDocumentSheet open={sending} onClose={() => setSending(false)} asEmployee={!manages} />
      <TimesheetsSheet open={monthly} onClose={() => setMonthly(false)} />
    </div>
  );
}

/** Los últimos 12 meses (AAAA-MM), empezando por el anterior al actual. */
function lastMonths(lang: string | undefined): { value: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { value, label: new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(d) };
  });
}

/** Envío manual del registro mensual (además del automático, si está activado en Empresa). */
function TimesheetsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const months = lastMonths(i18n.resolvedLanguage);
  const [month, setMonth] = useState(months[0]!.value);
  const send = useMutation({
    mutationFn: () => api<{ sent: number; skipped: number }>('/documents/timesheets', { method: 'POST', body: { month } }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success(t('documents.timesheetsSent', r));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  return (
    <Sheet open={open} onClose={onClose} title={t('documents.timesheetsTitle')} description={t('documents.timesheetsDesc')}>
      <div className="space-y-4 pt-1">
        <div>
          <label htmlFor="timesheets-month" className="mb-1.5 block text-sm font-medium">
            {t('documents.timesheetsMonth')}
          </label>
          <select id="timesheets-month" className={selectClass} value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <Button size="lg" block loading={send.isPending} onClick={() => send.mutate()} icon={<ClipboardCheck className="size-5" />}>
          {t('documents.timesheetsSend')}
        </Button>
      </div>
    </Sheet>
  );
}
