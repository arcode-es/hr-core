import type { PayrollAnalysis } from '@hr/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Banknote, CircleAlert, Download, FileUp, Send, Trash2 } from 'lucide-react';
import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { api, apiDownload } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useMode } from '../stores/meta';
import { useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { PageHeader } from '../ui/Page';
import { Spinner } from '../ui/Spinner';
import { selectClass } from '../ui/Switch';

/** «Nómina de octubre de 2026»: el mes anterior, que es el que se suele pagar. */
const defaultTitle = (lang: string | undefined, prefix: string): string => {
  const d = new Date();
  return `${prefix} ${new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(new Date(d.getFullYear(), d.getMonth() - 1, 1))}`;
};

/**
 * Reparto de nóminas: se sube el PDF de toda la plantilla, se revisa a quién va
 * cada página (propuesto por el DNI/NIE) y cada persona recibe un PDF solo con las suyas.
 */
export function Payroll() {
  const { t, i18n } = useTranslation();
  const ws = useWorkspace();
  const demo = useMode() === 'demo';
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<PayrollAnalysis | null>(null);
  const [owner, setOwner] = useState<Record<number, string>>({});
  const [title, setTitle] = useState(() => defaultTitle(i18n.resolvedLanguage, i18n.resolvedLanguage === 'en' ? 'Payslip' : 'Nómina de'));

  const analyze = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return api<PayrollAnalysis>('/documents/payroll', { method: 'POST', body: form });
    },
    onSuccess: (a) => {
      setAnalysis(a);
      setOwner(Object.fromEntries(a.pages.filter((p) => p.userId).map((p) => [p.page, p.userId!])));
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const send = useMutation({
    mutationFn: () =>
      api<{ sent: number }>(`/documents/payroll/${analysis!.id}/send`, {
        method: 'POST',
        body: { title: title.trim(), assignments: Object.entries(owner).map(([page, userId]) => ({ page: Number(page), userId })) },
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success(t('documents.payrollSent', { count: r.sent }));
      navigate('/documents');
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const discard = useMutation({
    mutationFn: () => api<void>(`/documents/payroll/${analysis!.id}`, { method: 'DELETE' }),
    onSettled: () => {
      setAnalysis(null);
      setOwner({});
    },
  });
  const sample = useMutation({
    mutationFn: () => apiDownload('/documents/payroll/sample.pdf', 'nominas-ejemplo.pdf'),
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  const names = useMemo(() => new Map((analysis?.people ?? []).map((p) => [p.userId, p.fullName])), [analysis]);
  const recipients = new Set(Object.values(owner)).size;
  const unassigned = (analysis?.pageCount ?? 0) - Object.keys(owner).length;

  if (ws.kind !== 'organization' || ws.role !== 'ADMIN') return <Navigate to="/documents" replace />;

  const pick = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) analyze.mutate(f);
  };

  return (
    <div className="animate-page space-y-4">
      <Link to="/documents" className="focus-ring -mb-2 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        {t('nav.documents')}
      </Link>
      <PageHeader title={t('documents.payrollTitle')} subtitle={ws.name} />

      {!analysis ? (
        <Card className="space-y-4 p-5">
          <p className="text-sm text-fg-muted">{t('documents.payrollDesc')}</p>
          <input ref={input} type="file" accept="application/pdf" className="sr-only" onChange={pick} tabIndex={-1} aria-hidden="true" />
          {analyze.isPending ? (
            <div role="status" className="flex items-center justify-center gap-3 rounded-2xl bg-surface-2 py-8 text-sm font-medium">
              <Spinner className="size-5" />
              {t('documents.payrollReading')}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="focus-ring flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-border-strong px-4 py-8 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
            >
              <FileUp className="size-7 text-accent-text" />
              <span className="font-semibold">{t('documents.payrollPick')}</span>
            </button>
          )}
          {demo && (
            <Button variant="ghost" block loading={sample.isPending} onClick={() => sample.mutate()} icon={<Download className="size-4" />}>
              {t('documents.payrollSample')}
            </Button>
          )}
        </Card>
      ) : (
        <>
          <Card className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
                <Banknote className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{analysis.fileName}</p>
                <p className="text-sm text-fg-muted">{t('documents.payrollPeople', { count: recipients })}</p>
                {unassigned > 0 && <p className="text-sm font-medium text-warning-text">{t('documents.payrollUnassigned', { count: unassigned })}</p>}
              </div>
            </div>
            <Field label={t('documents.payrollDocTitle')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
          </Card>

          <Card className="overflow-hidden">
            <ul>
              {analysis.pages.map((p, i) => {
                const chosen = owner[p.page] ?? '';
                const unknownDni = p.dni && !p.userId;
                return (
                  <li key={p.page} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3', i > 0 && 'edge-t', !chosen && 'bg-warning-soft/40')}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{t('documents.payrollPage', { n: p.page })}</span>
                      <span className={cn('flex items-center gap-1 text-xs', unknownDni || !p.dni ? 'text-warning-text' : 'text-fg-muted')}>
                        {(unknownDni || !p.dni) && <CircleAlert className="size-3.5" />}
                        {p.dni ? (unknownDni ? t('documents.payrollUnknownDni', { dni: p.dni }) : t('documents.payrollDni', { dni: p.dni })) : t('documents.payrollNoDni')}
                      </span>
                    </span>
                    <label htmlFor={`page-${p.page}`} className="sr-only">
                      {t('documents.payrollAssignTo', { n: p.page })}
                    </label>
                    <select
                      id={`page-${p.page}`}
                      className={cn(selectClass, 'h-11 w-full sm:w-64')}
                      value={chosen}
                      onChange={(e) =>
                        setOwner((prev) => {
                          const next = { ...prev };
                          if (e.target.value) next[p.page] = e.target.value;
                          else delete next[p.page];
                          return next;
                        })
                      }
                    >
                      <option value="">{t('documents.payrollNobody')}</option>
                      {analysis.people.map((person) => (
                        <option key={person.userId} value={person.userId}>
                          {person.fullName}
                          {person.dniNie ? ` · ${person.dniNie}` : ''}
                        </option>
                      ))}
                    </select>
                    {chosen && <span className="sr-only">{names.get(chosen)}</span>}
                  </li>
                );
              })}
            </ul>
          </Card>

          <p className="text-center text-sm text-fg-muted">{t('documents.payrollExpires')}</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Button variant="secondary" size="lg" loading={discard.isPending} onClick={() => discard.mutate()} icon={<Trash2 className="size-4" />}>
              {t('documents.payrollDiscard')}
            </Button>
            <Button size="lg" loading={send.isPending} disabled={!recipients || title.trim().length < 2} onClick={() => send.mutate()} icon={<Send className="size-4" />}>
              {t('documents.payrollSend', { count: recipients })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
