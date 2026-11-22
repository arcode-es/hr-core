import type { CustomCategoryDto, ExpenseCategoryId, ExpenseConfig, ExpenseDto, ExpenseSummaryRow } from '@hr/shared';
import { EXPENSE_CATEGORIES } from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Camera, Check, ChevronLeft, ChevronRight, CircleCheck, Image as ImageIcon, PencilLine, Plus, Receipt, Tags, Trash2, Wallet, X } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { addMonths, isoDate, startOfMonth } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { stampPhoto } from '../lib/photo';
import { queryClient } from '../lib/query';
import { type ExpenseDraft, ExpenseFormSheet } from '../expenses/ExpenseForm';
import { CATEGORY_COLOR, CATEGORY_ICON, formatMoney, STATUS_TONE } from '../expenses/meta';
import { useSession, useWorkspace } from '../stores/session';
import { toast } from '../stores/toast';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { EmptyState, PageHeader } from '../ui/Page';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';

const refresh = (): void => void queryClient.invalidateQueries({ queryKey: ['expenses'] });
const monthRange = (month: Date): string => `from=${isoDate(month)}&to=${isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0))}`;

const DEFAULT_CONFIG: ExpenseConfig = { currency: 'EUR', mileageRatePerKm: 0.26, customCategories: [] };

/** Moneda, tarifa y categorías del espacio. Se guarda la última copia para poder añadir gastos sin conexión. */
function useConfig() {
  const workspaceId = useSession((s) => s.workspaceId);
  const key = `hr.expenses.config.${workspaceId}`;
  return useQuery({
    queryKey: ['expenses', workspaceId, 'config'],
    queryFn: async () => {
      const config = await api<ExpenseConfig>('/expenses/config');
      try {
        localStorage.setItem(key, JSON.stringify(config));
      } catch {
        /* sin almacenamiento */
      }
      return config;
    },
    placeholderData: () => {
      try {
        return (JSON.parse(localStorage.getItem(key) ?? 'null') as ExpenseConfig | null) ?? DEFAULT_CONFIG;
      } catch {
        return DEFAULT_CONFIG;
      }
    },
  });
}

function usePendingExpenses(enabled: boolean) {
  const workspaceId = useSession((s) => s.workspaceId);
  return useQuery({ queryKey: ['expenses', workspaceId, 'pending'], queryFn: () => api<ExpenseDto[]>('/expenses/pending'), enabled, refetchInterval: 120_000 });
}

function MonthNav({ month, onChange }: { month: Date; onChange: (m: Date) => void }) {
  const { t, i18n } = useTranslation();
  const isCurrent = month.getTime() === startOfMonth(new Date()).getTime();
  const arrow = 'focus-ring flex size-11 items-center justify-center rounded-xl text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30';
  return (
    <Card className="flex items-center gap-1 p-1.5">
      <button type="button" onClick={() => onChange(addMonths(month, -1))} aria-label={t('shifts.prev')} className={arrow}>
        <ChevronLeft className="size-5" />
      </button>
      <p className="flex-1 text-center font-semibold first-letter:uppercase">
        {new Intl.DateTimeFormat(i18n.resolvedLanguage, { month: 'long', year: 'numeric' }).format(month)}
      </p>
      <button type="button" onClick={() => onChange(addMonths(month, 1))} disabled={isCurrent} aria-label={t('shifts.next')} className={arrow}>
        <ChevronRight className="size-5" />
      </button>
    </Card>
  );
}

function CategoryTile({ category, className }: { category: ExpenseCategoryId; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl text-white', className)} style={{ backgroundColor: CATEGORY_COLOR[category] }}>
      <Icon className="size-5" />
    </span>
  );
}

const shortDate = (date: string, lang: string | undefined): string =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));

function ExpenseRow({ e, onClick, showUser }: { e: ExpenseDto; onClick: () => void; showUser?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const label = e.customCategoryName ?? t(`expenses.cat_${e.category}`);
  return (
    <button type="button" onClick={onClick} className="focus-ring flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2">
      <CategoryTile category={e.category} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{showUser ? e.user.fullName : (e.merchantName ?? label)}</span>
        <span className="block truncate text-sm text-fg-muted">
          {shortDate(e.date, lang)} · {showUser && e.merchantName ? `${e.merchantName} · ` : ''}
          {e.merchantName || showUser ? label : t(`expenses.pay_${e.paymentMethod}`)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cn('block font-bold tabular-nums', e.status === 'REJECTED' && 'text-fg-muted line-through')}>{formatMoney(e.amount, e.currency, lang)}</span>
        <Badge tone={STATUS_TONE[e.status]} className="mt-0.5">
          {t(`expenses.status_${e.status}`)}
        </Badge>
      </span>
    </button>
  );
}

// ── Detalle ──────────────────────────────────────────────────────────────

function ReceiptImage({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery({
    queryKey: ['expenses', 'receipt', id],
    queryFn: () => api<{ url: string }>(`/expenses/${id}/receipt`),
    staleTime: 120_000,
  });
  if (isPending) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl bg-surface-2 text-fg-subtle">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (isError || !data) return <p className="rounded-2xl bg-surface-2 py-8 text-center text-sm text-fg-muted">{t('errors.UNKNOWN')}</p>;
  return (
    <a href={data.url} target="_blank" rel="noreferrer" className="focus-ring block rounded-2xl">
      <img src={data.url} alt={t('expenses.receiptAlt')} className="edge max-h-72 w-full rounded-2xl bg-surface-2 object-contain" />
    </a>
  );
}

interface DetailProps {
  expense: ExpenseDto | null;
  onClose: () => void;
  onEdit?: (e: ExpenseDto) => void;
  /** Acciones de quien aprueba. */
  onDecide?: (e: ExpenseDto, decision: 'APPROVE' | 'REJECT') => void;
}

function ExpenseDetail({ expense: e, onClose, onEdit, onDecide }: DetailProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const me = useSession((s) => s.user)!;
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success(t('expenses.deleted'));
      onClose();
    },
    onError: (err) => toast.error(errorMessage(t, err)),
  });

  const mine = e?.user.id === me.id;
  const editable = mine && (e?.status === 'PENDING' || e?.status === 'REJECTED');
  const rows: [string, string | null][] = e
    ? [
        [t('manual.date'), new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(new Date(`${e.date}T12:00:00`))],
        [t('expenses.category'), e.customCategoryName ?? t(`expenses.cat_${e.category}`)],
        [t('expenses.merchant'), e.merchantName],
        [t('expenses.km'), e.distanceKm !== null ? `${new Intl.NumberFormat(lang).format(e.distanceKm)} km` : null],
        [t('expenses.tax'), e.taxAmount !== null ? formatMoney(e.taxAmount, e.currency, lang) : null],
        [t('expenses.payment'), t(`expenses.pay_${e.paymentMethod}`)],
        [t('expenses.location'), e.locationName],
        [t('expenses.notes'), e.notes],
        [t('expenses.reviewedBy'), e.reviewedBy],
      ]
    : [];

  return (
    <Sheet open={!!e} onClose={onClose} title={e ? (mine ? t('expenses.detailTitle') : e.user.fullName) : ''} className="sm:max-w-lg">
      {e && (
        <div className="space-y-4 pt-1">
          <div className="flex items-center gap-3">
            <CategoryTile category={e.category} className="size-12" />
            <p className="flex-1 text-3xl font-bold tracking-tight tabular-nums">{formatMoney(e.amount, e.currency, lang)}</p>
            <Badge tone={STATUS_TONE[e.status]}>{t(`expenses.status_${e.status}`)}</Badge>
          </div>
          {e.status === 'REJECTED' && e.rejectionReason && (
            <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">{t('manual.rejectedBecause', { reason: e.rejectionReason })}</p>
          )}
          {e.hasReceipt ? (
            <ReceiptImage id={e.id} />
          ) : (
            <p className="flex items-center justify-center gap-2 rounded-2xl bg-surface-2 py-5 text-sm text-fg-muted">
              <ImageIcon className="size-4" />
              {t('expenses.noReceipt')}
            </p>
          )}
          <dl className="edge divide-y divide-border rounded-2xl text-sm">
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="shrink-0 text-fg-muted">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
          </dl>
          {editable && onEdit && (
            <div className="flex gap-2.5">
              <Button variant="secondary" className="text-danger-text" loading={remove.isPending} onClick={() => remove.mutate(e.id)} aria-label={t('expenses.delete')} icon={<Trash2 className="size-5" />} />
              <Button block onClick={() => onEdit(e)} icon={<PencilLine className="size-4" />}>
                {e.status === 'REJECTED' ? t('expenses.fixAndResend') : t('expenses.edit')}
              </Button>
            </div>
          )}
          {onDecide && e.status === 'PENDING' && !mine && (
            <div className="grid grid-cols-2 gap-2.5">
              <Button variant="secondary" size="lg" onClick={() => onDecide(e, 'REJECT')} icon={<X className="size-4" />}>
                {t('review.reject')}
              </Button>
              <Button size="lg" onClick={() => onDecide(e, 'APPROVE')} icon={<Check className="size-4" />}>
                {t('review.approve')}
              </Button>
            </div>
          )}
          {onDecide && e.status === 'PENDING' && mine && <p className="text-center text-sm text-fg-muted">{t('expenses.ownNotice')}</p>}
        </div>
      )}
    </Sheet>
  );
}

// ── Mis gastos ───────────────────────────────────────────────────────────

function MyExpenses({ config, onNew, onEdit }: { config: ExpenseConfig | undefined; onNew: () => void; onEdit: (e: ExpenseDto) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const me = useSession((s) => s.user)!;
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['expenses', workspaceId, 'mine', month.getTime()], queryFn: () => api<ExpenseDto[]>(`/expenses?${monthRange(month)}`) });
  const summary = useQuery({
    queryKey: ['expenses', workspaceId, 'summary', month.getTime()],
    queryFn: () => api<ExpenseSummaryRow[]>(`/expenses/summary?${monthRange(month)}`),
  });
  const mine = summary.data?.find((r) => r.user.id === me.id);
  const currency = config?.currency ?? 'EUR';
  const money = (n: number): string => formatMoney(n, currency, lang);
  const expense = list.data?.find((e) => e.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <MonthNav month={month} onChange={setMonth} />

      <Card className="p-4">
        <p className="text-sm font-medium text-fg-muted">{t('expenses.toReimburse')}</p>
        <p className="mt-0.5 text-4xl font-bold tracking-tight tabular-nums">{money(mine?.toReimburse ?? 0)}</p>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          {(
            [
              [t('expenses.status_PENDING'), mine?.pending ?? 0],
              [t('expenses.status_REIMBURSED'), mine?.reimbursed ?? 0],
              [t('expenses.companyCardShort'), mine?.companyCard ?? 0],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl bg-surface-2/70 px-1 py-2.5">
              <dt className="truncate text-[11px] font-medium text-fg-muted">{label}</dt>
              <dd className="mt-0.5 text-sm font-bold tabular-nums">{money(value)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {list.isPending ? (
        <Card className="flex justify-center py-14 text-fg-subtle">
          <Spinner className="size-6" />
        </Card>
      ) : list.data?.length ? (
        <Card className="overflow-hidden">
          <ul>
            {list.data.map((e, i) => (
              <li key={e.id} className={cn(i > 0 && 'edge-t')}>
                <ExpenseRow e={e} onClick={() => setSelected(e.id)} />
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<Receipt />}
            title={t('expenses.emptyTitle')}
            body={t('expenses.emptyBody')}
            action={
              <Button onClick={onNew} icon={<Camera className="size-[18px]" />}>
                {t('expenses.add')}
              </Button>
            }
          />
        </Card>
      )}

      <ExpenseDetail
        expense={expense}
        onClose={() => setSelected(null)}
        onEdit={(e) => {
          setSelected(null);
          onEdit(e);
        }}
      />
    </div>
  );
}

// ── Por aprobar ──────────────────────────────────────────────────────────

function Approvals() {
  const { t } = useTranslation();
  const { data, isPending } = usePendingExpenses(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ExpenseDto | null>(null);
  const [reason, setReason] = useState('');

  const decide = useMutation({
    mutationFn: (v: { id: string; decision: 'APPROVE' | 'REJECT'; reason?: string }) =>
      api<ExpenseDto>(`/expenses/${v.id}/review`, { method: 'POST', body: { decision: v.decision, reason: v.reason } }),
    onSuccess: (_, v) => {
      refresh();
      toast.success(t(v.decision === 'APPROVE' ? 'expenses.approved' : 'expenses.rejected'));
      setRejecting(null);
      setSelected(null);
      setReason('');
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

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
        <EmptyState icon={<CircleCheck />} title={t('expenses.nothingPendingTitle')} body={t('expenses.nothingPendingBody')} />
      </Card>
    );
  }
  const expense = data.find((e) => e.id === selected) ?? null;

  return (
    <>
      <Card className="overflow-hidden">
        <ul>
          {data.map((e, i) => (
            <li key={e.id} className={cn(i > 0 && 'edge-t')}>
              <ExpenseRow e={e} showUser onClick={() => setSelected(e.id)} />
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-3 text-sm text-fg-muted">{t('expenses.approvalHint')}</p>

      <ExpenseDetail
        expense={expense}
        onClose={() => setSelected(null)}
        onDecide={(e, decision) => (decision === 'APPROVE' ? decide.mutate({ id: e.id, decision }) : (setSelected(null), setRejecting(e)))}
      />

      <Sheet
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={t('expenses.rejectTitle')}
        description={rejecting ? t('review.rejectDesc', { name: rejecting.user.fullName }) : undefined}
      >
        <form
          className="space-y-3 pt-1"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (rejecting && reason.trim().length >= 5) decide.mutate({ id: rejecting.id, decision: 'REJECT', reason: reason.trim() });
          }}
        >
          <textarea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            placeholder={t('expenses.rejectPlaceholder')}
            aria-label={t('review.reason')}
            className="edge w-full rounded-control bg-surface px-3.5 py-3 text-base placeholder:text-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none"
          />
          <Button type="submit" variant="danger" size="lg" block loading={decide.isPending} disabled={reason.trim().length < 5}>
            {t('review.rejectConfirm')}
          </Button>
        </form>
      </Sheet>
    </>
  );
}

// ── Liquidación ──────────────────────────────────────────────────────────

function Settlement({ config, canPay }: { config: ExpenseConfig | undefined; canPay: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [paying, setPaying] = useState<ExpenseSummaryRow | null>(null);
  const currency = config?.currency ?? 'EUR';
  const money = (n: number): string => formatMoney(n, currency, lang);

  const { data, isPending } = useQuery({
    queryKey: ['expenses', workspaceId, 'summary', month.getTime()],
    queryFn: () => api<ExpenseSummaryRow[]>(`/expenses/summary?${monthRange(month)}`),
  });
  const rows = (data ?? []).filter((r) => r.count > 0);
  const total = rows.reduce((s, r) => s + r.toReimburse, 0);

  const pay = useMutation({
    mutationFn: (userId: string) =>
      api<{ reimbursed: number; amount: number }>('/expenses/reimburse', {
        method: 'POST',
        body: { userId, from: isoDate(month), to: isoDate(new Date(month.getFullYear(), month.getMonth() + 1, 0)) },
      }),
    onSuccess: (r) => {
      refresh();
      toast.success(t('expenses.paid', { amount: money(r.amount) }));
      setPaying(null);
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  return (
    <div className="space-y-4">
      <MonthNav month={month} onChange={setMonth} />
      <Card className="flex items-center gap-4 p-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
          <Wallet className="size-6" />
        </span>
        <div>
          <p className="text-sm font-medium text-fg-muted">{t('expenses.totalToReimburse')}</p>
          <p className="text-3xl font-bold tracking-tight tabular-nums">{money(total)}</p>
        </div>
      </Card>

      {isPending ? (
        <Card className="flex justify-center py-14 text-fg-subtle">
          <Spinner className="size-6" />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<Receipt />} title={t('expenses.noneThisMonthTitle')} body={t('expenses.noneThisMonthBody')} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.user.id}>
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={r.user.fullName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.user.fullName}</p>
                    <p className="text-sm text-fg-muted">{t('expenses.count', { count: r.count })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-fg-muted">{t('expenses.toReimburse')}</p>
                    <p className={cn('text-xl font-bold tabular-nums', r.toReimburse === 0 && 'text-fg-subtle')}>{money(r.toReimburse)}</p>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {(
                    [
                      [t('expenses.status_PENDING'), r.pending, r.pending > 0],
                      [t('expenses.status_REIMBURSED'), r.reimbursed, false],
                      [t('expenses.companyCardShort'), r.companyCard, false],
                    ] as const
                  ).map(([label, value, warn]) => (
                    <div key={label} className="rounded-xl bg-surface-2/70 px-1 py-2">
                      <dt className="truncate text-[11px] font-medium text-fg-muted">{label}</dt>
                      <dd className={cn('mt-0.5 text-sm font-bold tabular-nums', warn && 'text-warning-text')}>{money(value)}</dd>
                    </div>
                  ))}
                </dl>
                {canPay && r.toReimburse > 0 && (
                  <Button variant="secondary" block className="mt-3" onClick={() => setPaying(r)} icon={<Check className="size-4" />}>
                    {t('expenses.markPaid')}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!paying} onClose={() => setPaying(null)} title={t('expenses.payTitle')}>
        {paying && (
          <div className="space-y-4 pt-1">
            <p className="text-fg-muted">{t('expenses.payBody', { amount: money(paying.toReimburse), name: paying.user.fullName })}</p>
            <Button size="lg" block loading={pay.isPending} onClick={() => pay.mutate(paying.user.id)}>
              {t('expenses.payConfirm', { amount: money(paying.toReimburse) })}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ── Categorías propias ───────────────────────────────────────────────────

function CategoriesSheet({ open, onClose, categories }: { open: boolean; onClose: () => void; categories: CustomCategoryDto[] }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [base, setBase] = useState<ExpenseCategoryId>('OTHER');
  const create = useMutation({
    mutationFn: () => api('/expenses/categories', { method: 'POST', body: { name: name.trim(), baseCategory: base } }),
    onSuccess: () => {
      refresh();
      setName('');
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const archive = useMutation({
    mutationFn: (id: string) => api(`/expenses/categories/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(t, e)),
  });
  const active = categories.filter((c) => c.isActive);

  return (
    <Sheet open={open} onClose={onClose} title={t('expenses.categoriesTitle')} description={t('expenses.categoriesDesc')}>
      <div className="space-y-4 pt-1">
        {active.length > 0 && (
          <ul className="edge divide-y divide-border rounded-2xl">
            {active.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <CategoryTile category={c.baseCategory} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.name}</span>
                  <span className="block text-xs text-fg-muted">{t(`expenses.cat_${c.baseCategory}`)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => archive.mutate(c.id)}
                  aria-label={t('expenses.archiveCategory', { name: c.name })}
                  className="focus-ring flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-danger-text"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) create.mutate();
          }}
        >
          <Field label={t('expenses.categoryName')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('expenses.categoryNamePlaceholder')} maxLength={40} />
          <div>
            <label htmlFor="cat-base" className="mb-1.5 block text-sm font-medium">
              {t('expenses.categoryBase')}
            </label>
            <select
              id="cat-base"
              value={base}
              onChange={(e) => setBase(e.target.value as ExpenseCategoryId)}
              className="edge h-12 w-full rounded-control bg-surface px-3 text-base focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none"
            >
              {EXPENSE_CATEGORIES.filter((c) => c !== 'MILEAGE').map((c) => (
                <option key={c} value={c}>
                  {t(`expenses.cat_${c}`)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" block loading={create.isPending} disabled={name.trim().length < 2} icon={<Plus className="size-4" />}>
            {t('expenses.addCategory')}
          </Button>
        </form>
      </div>
    </Sheet>
  );
}

// ── Página ───────────────────────────────────────────────────────────────

export function Expenses() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const approves = ws.kind === 'organization' && (ws.role === 'ADMIN' || ws.role === 'MANAGER');
  const seesTeam = ws.kind === 'organization' && ws.role !== 'EMPLOYEE';
  const inspector = ws.kind === 'organization' && ws.role === 'INSPECTOR';
  const config = useConfig();
  const pending = usePendingExpenses(approves);
  const count = pending.data?.length ?? 0;
  const [tab, setTab] = useState<'mine' | 'approve' | 'settle'>(inspector ? 'settle' : 'mine');
  const [draft, setDraft] = useState<ExpenseDraft | null>(null);
  const [categories, setCategories] = useState(false);
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);

  // «Añadir gasto» abre la cámara directamente; el formulario llega con la foto ya adjunta.
  const onPhoto = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      setDraft({ photo: await stampPhoto(file, []) });
    } catch {
      toast.error(t('clock.photoError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-page">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} tabIndex={-1} aria-hidden="true" />
      <PageHeader
        title={t('nav.expenses')}
        subtitle={ws.kind === 'organization' ? ws.name : undefined}
        action={
          approves && (
            <Button variant="ghost" size="sm" onClick={() => setCategories(true)} icon={<Tags className="size-4" />}>
              {t('expenses.categories')}
            </Button>
          )
        }
      />

      {!inspector && (
        <div className="mb-4 grid grid-cols-[1fr_auto] gap-2.5">
          <Button size="lg" loading={busy} onClick={() => camera.current?.click()} icon={<Camera className="size-5" />}>
            {t('expenses.add')}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => setDraft({})}>
            {t('expenses.withoutPhoto')}
          </Button>
        </div>
      )}

      {seesTeam && (
        <Segmented
          className="mb-4"
          label={t('nav.expenses')}
          value={tab}
          onChange={setTab}
          options={[
            ...(inspector ? [] : [{ value: 'mine' as const, label: t('expenses.tabMine') }]),
            ...(approves ? [{ value: 'approve' as const, label: count ? t('expenses.tabApproveCount', { count }) : t('expenses.tabApprove') }] : []),
            { value: 'settle' as const, label: t('expenses.tabSettle') },
          ]}
        />
      )}

      {tab === 'approve' && approves ? (
        <Approvals />
      ) : tab === 'settle' && seesTeam ? (
        <Settlement config={config.data} canPay={approves} />
      ) : (
        <MyExpenses config={config.data} onNew={() => camera.current?.click()} onEdit={(e) => setDraft({ expense: e })} />
      )}

      <ExpenseFormSheet draft={draft} onClose={() => setDraft(null)} config={config.data} />
      <CategoriesSheet open={categories} onClose={() => setCategories(false)} categories={config.data?.customCategories ?? []} />
    </div>
  );
}
