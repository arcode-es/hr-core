import { type DepartmentDto, DOCUMENT_CATEGORIES, type DocumentCategoryId, EMPLOYEE_DOCUMENT_CATEGORIES, MAX_DOCUMENT_BYTES, type MemberDto, type SendDocumentInput } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, FileUp, Info, X } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { queryClient } from '../lib/query';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { formatBytes } from './meta';

const selectClass =
  'edge h-12 w-full rounded-control bg-surface px-3 text-base text-fg focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none';

/** `asEmployee`: justificante hacia los responsables. Si no, envío del responsable a la plantilla. */
export function SendDocumentSheet({ open, onClose, asEmployee }: { open: boolean; onClose: () => void; asEmployee: boolean }) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={asEmployee ? t('documents.sendProofTitle') : t('documents.sendTitle')}
      description={asEmployee ? t('documents.sendProofDesc') : undefined}
      className="sm:max-w-lg"
    >
      {open && <SendForm onClose={onClose} asEmployee={asEmployee} />}
    </Sheet>
  );
}

function SendForm({ onClose, asEmployee }: { onClose: () => void; asEmployee: boolean }) {
  const { t, i18n } = useTranslation();
  const workspaceId = useSession((s) => s.workspaceId);
  const me = useSession((s) => s.user)!;
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategoryId>(asEmployee ? 'MEDICAL_LEAVE' : 'PAYROLL');
  const [audience, setAudience] = useState<'ALL' | 'SOME' | 'DEPT'>('SOME');
  const [departmentId, setDepartmentId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [signature, setSignature] = useState<'read' | 'sign'>('read');
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({ queryKey: ['members', workspaceId], queryFn: () => api<MemberDto[]>('/members'), enabled: !asEmployee });
  const departments = useQuery({ queryKey: ['departments', workspaceId], queryFn: () => api<DepartmentDto[]>('/departments'), enabled: !asEmployee });
  const people = (members.data ?? []).filter((m) => m.active && m.role !== 'INSPECTOR' && m.userId !== me.id);
  const depts = (departments.data ?? []).filter((d) => d.members > 0);
  const categories = asEmployee ? EMPLOYEE_DOCUMENT_CATEGORIES : DOCUMENT_CATEGORIES;

  const pick = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX_DOCUMENT_BYTES) {
      setError(t('documents.tooBig'));
      return;
    }
    setError(null);
    setFile(f);
    // El nombre del archivo suele ser un buen título de partida.
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
  };

  const send = useMutation({
    mutationFn: () => {
      const data: SendDocumentInput = {
        title: title.trim(),
        category,
        requiresSignature: !asEmployee && signature === 'sign',
        recipients: asEmployee ? 'MANAGERS' : audience === 'ALL' ? 'ALL' : audience === 'DEPT' ? { departmentId } : [...selected],
        dueDate: !asEmployee && dueDate ? dueDate : null,
      };
      const form = new FormData();
      form.append('data', JSON.stringify(data));
      form.append('file', file!, file!.name);
      return api<unknown[]>('/documents', { method: 'POST', body: form });
    },
    onSuccess: (rows) => {
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success(t('documents.sentTo', { count: rows.length }));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!file) return setError(t('documents.needFile'));
    if (title.trim().length < 2) return setError(t('documents.needTitle'));
    if (!asEmployee && audience === 'SOME' && selected.size === 0) return setError(t('documents.needRecipients'));
    if (!asEmployee && audience === 'DEPT' && !departmentId) return setError(t('documents.needRecipients'));
    setError(null);
    send.mutate();
  };

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form onSubmit={submit} noValidate className="space-y-4 pt-1">
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={pick} tabIndex={-1} aria-hidden="true" />
      {file ? (
        <div className="edge flex items-center gap-3 rounded-2xl bg-surface-2/50 p-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
            <FileUp className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{file.name}</p>
            <p className="text-sm text-fg-muted">{formatBytes(file.size, i18n.resolvedLanguage)}</p>
          </div>
          <button type="button" onClick={() => setFile(null)} aria-label={t('documents.removeFile')} className="focus-ring flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg">
            <X className="size-5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="focus-ring flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-border-strong px-4 py-7 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
        >
          <FileUp className="size-7 text-accent-text" />
          <span className="font-semibold">{t('documents.chooseFile')}</span>
          <span className="text-sm text-fg-muted">{t('documents.fileHint')}</span>
        </button>
      )}

      <Field label={t('documents.title')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(asEmployee ? 'documents.titlePlaceholderProof' : 'documents.titlePlaceholder')} maxLength={140} />

      <div>
        <label htmlFor="doc-category" className="mb-1.5 block text-sm font-medium">
          {t('documents.category')}
        </label>
        <select id="doc-category" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategoryId)} className={selectClass}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {t(`documents.cat_${c}`)}
            </option>
          ))}
        </select>
      </div>

      {!asEmployee && (
        <>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('documents.recipients')}</p>
            <Segmented
              label={t('documents.recipients')}
              value={audience}
              onChange={setAudience}
              options={[
                { value: 'SOME', label: t('documents.audienceSome') },
                ...(depts.length ? [{ value: 'DEPT' as const, label: t('documents.toDepartment') }] : []),
                { value: 'ALL', label: t('documents.audienceAll', { count: people.length }) },
              ]}
            />
            {audience === 'DEPT' && (
              <div className="mt-2">
                <label htmlFor="doc-department" className="sr-only">
                  {t('documents.chooseDepartment')}
                </label>
                <select id="doc-department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={selectClass}>
                  <option value="">{t('documents.chooseDepartment')}</option>
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {t('team.departmentMembers', { count: d.members })}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {audience === 'SOME' && (
              <ul className="edge mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-2xl">
                {people.map((p) => {
                  const on = selected.has(p.userId);
                  return (
                    <li key={p.userId}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(p.userId)}
                        className={cn('focus-ring flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors', on ? 'bg-accent-soft' : 'hover:bg-surface-2')}
                      >
                        <Avatar name={p.fullName} size="sm" />
                        <span className="min-w-0 flex-1 truncate font-medium">{p.fullName}</span>
                        <span className={cn('flex size-6 items-center justify-center rounded-md border-2', on ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong')}>
                          {on && <Check className="size-4" strokeWidth={3} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {people.length === 0 && <li className="px-4 py-5 text-center text-sm text-fg-muted">{t('documents.noPeople')}</li>}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">{t('documents.requirement')}</p>
            <Segmented
              label={t('documents.requirement')}
              value={signature}
              onChange={setSignature}
              options={[
                { value: 'read', label: t('documents.requireRead') },
                { value: 'sign', label: t('documents.requireSign') },
              ]}
            />
            <p className="mt-1.5 flex gap-2 text-sm text-fg-muted">
              <Info className="mt-0.5 size-4 shrink-0" />
              {t(signature === 'sign' ? 'documents.requireSignHint' : 'documents.requireReadHint')}
            </p>
          </div>

          <Field
            label={t('documents.dueDate')}
            type="date"
            value={dueDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDueDate(e.target.value)}
            hint={t('documents.dueHint')}
          />
        </>
      )}

      {error && (
        <p role="alert" className="rounded-control bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block loading={send.isPending}>
        {t('documents.send')}
      </Button>
    </form>
  );
}
