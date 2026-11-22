import {
  EXPENSE_CATEGORIES,
  type ExpenseCategoryId,
  type ExpenseConfig,
  type ExpenseDto,
  type ExpenseInput,
  type LocationDto,
  type OcrSuggestion,
} from '@hr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Camera, Sparkles, X } from 'lucide-react';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, isNetworkError } from '../lib/api';
import { cn } from '../lib/cn';
import { isoDate } from '../lib/dates';
import { errorMessage } from '../lib/errors';
import { enqueue } from '../lib/outbox';
import { stampPhoto } from '../lib/photo';
import { queryClient } from '../lib/query';
import { useSession } from '../stores/session';
import { toast } from '../stores/toast';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { Spinner } from '../ui/Spinner';
import { CATEGORY_COLOR, CATEGORY_ICON, formatMoney, parseAmount } from './meta';

/** Importe como lo escribe una persona: dos decimales y coma. */
const asText = (n: number): string => n.toFixed(2).replace('.', ',');

const selectClass =
  'edge h-12 w-full rounded-control bg-surface px-3 text-base text-fg focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none';

export interface ExpenseDraft {
  /** Gasto existente a editar; sin él se crea uno nuevo. */
  expense?: ExpenseDto;
  /** Foto recién hecha, ya comprimida. */
  photo?: Blob | null;
}

export function ExpenseFormSheet({ draft, onClose, config }: { draft: ExpenseDraft | null; onClose: () => void; config: ExpenseConfig | undefined }) {
  const { t } = useTranslation();
  return (
    <Sheet open={!!draft} onClose={onClose} title={draft?.expense ? t('expenses.editTitle') : t('expenses.newTitle')} className="sm:max-w-lg">
      {draft && config && <ExpenseForm draft={draft} onClose={onClose} config={config} />}
    </Sheet>
  );
}

function ExpenseForm({ draft, onClose, config }: { draft: ExpenseDraft; onClose: () => void; config: ExpenseConfig }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const workspaceId = useSession((s) => s.workspaceId);
  const editing = draft.expense;

  const [photo, setPhoto] = useState<Blob | null>(draft.photo ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [category, setCategory] = useState<ExpenseCategoryId>(editing?.category ?? 'MEAL');
  const [customId, setCustomId] = useState<string | null>(editing?.customCategoryId ?? null);
  const [amount, setAmount] = useState(editing && editing.category !== 'MILEAGE' ? asText(editing.amount) : '');
  const [km, setKm] = useState(editing?.distanceKm ? String(editing.distanceKm).replace('.', ',') : '');
  const [tax, setTax] = useState(editing?.taxAmount != null ? asText(editing.taxAmount) : '');
  const [date, setDate] = useState(editing?.date ?? isoDate(new Date()));
  const [merchant, setMerchant] = useState(editing?.merchantName ?? '');
  const [payment, setPayment] = useState<ExpenseInput['paymentMethod']>(editing?.paymentMethod ?? 'EMPLOYEE_PAID');
  const [locationId, setLocationId] = useState(editing?.locationId ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [ocr, setOcr] = useState<OcrSuggestion | null>(null);
  const [reading, setReading] = useState(false);
  const [amountError, setAmountError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Lo que el usuario ya ha escrito no lo pisa una propuesta que llega después.
  const touched = useRef({ amount: !!editing, date: !!editing, merchant: !!editing, tax: !!editing });

  const locations = useQuery({ queryKey: ['locations', workspaceId], queryFn: () => api<LocationDto[]>('/locations') });
  const mileage = category === 'MILEAGE';
  const customCategories = config.customCategories.filter((c) => c.isActive || c.id === customId);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // Lectura automática del ticket: propone, nunca decide.
  useEffect(() => {
    if (!photo || editing) return;
    let cancelled = false;
    setReading(true);
    const form = new FormData();
    form.append('receipt', photo, 'ticket.jpg');
    api<OcrSuggestion>('/expenses/ocr', { method: 'POST', body: form })
      .then((s) => {
        if (cancelled) return;
        const found = s.amount !== null || s.date !== null || s.merchantName !== null;
        if (!found) return;
        setOcr(s);
        if (s.amount !== null && !touched.current.amount) setAmount(asText(s.amount));
        if (s.taxAmount !== null && !touched.current.tax) setTax(asText(s.taxAmount));
        if (s.date !== null && !touched.current.date) setDate(s.date);
        if (s.merchantName !== null && !touched.current.merchant) setMerchant(s.merchantName);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setReading(false));
    return () => {
      cancelled = true;
    };
  }, [photo, editing]);

  const pickPhoto = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhoto(await stampPhoto(file, []));
    } catch {
      toast.error(t('clock.photoError'));
    }
  };

  const kmValue = parseAmount(km);
  const mileageAmount = Number.isFinite(kmValue) ? Math.round(kmValue * config.mileageRatePerKm * 100) / 100 : 0;

  const save = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const taxValue = parseAmount(tax);
      const data: ExpenseInput = {
        category,
        customCategoryId: customId,
        amount: mileage ? undefined : parseAmount(amount),
        taxAmount: mileage || !Number.isFinite(taxValue) ? null : taxValue,
        date,
        merchantName: merchant.trim() || null,
        paymentMethod: payment,
        distanceKm: mileage ? kmValue : null,
        locationId: locationId || null,
        notes: notes.trim() || null,
        ocrData: ocr,
      };
      // Identificador propio: si hay que reenviarlo desde la cola, no se duplica.
      if (!editing) data.clientUuid = crypto.randomUUID();
      const form = new FormData();
      form.append('data', JSON.stringify(data));
      if (photo) form.append('receipt', photo, 'ticket.jpg');
      try {
        return await api<ExpenseDto>(editing ? `/expenses/${editing.id}` : '/expenses', { method: editing ? 'PATCH' : 'POST', body: form });
      } catch (e) {
        // Sin cobertura, un gasto nuevo se guarda en el móvil y se envía después.
        if (!isNetworkError(e) || editing) throw e;
        await enqueue({ kind: 'expense', workspaceId, data: JSON.stringify(data), file: photo ?? undefined });
        return null;
      }
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      if (!saved) toast.info(t('offline.expenseSaved'));
      else toast.success(saved.status === 'PENDING' ? t('expenses.sent') : t('expenses.saved'));
      onClose();
    },
    onError: (e) => toast.error(errorMessage(t, e)),
  });

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const value = mileage ? kmValue : parseAmount(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setAmountError(true);
      return;
    }
    save.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 pt-1">
      <input ref={fileInput} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pickPhoto} tabIndex={-1} aria-hidden="true" />
      {preview ? (
        <div className="edge flex items-center gap-3 rounded-2xl bg-surface-2/50 p-2">
          <img src={preview} alt={t('expenses.receiptAlt')} className="size-16 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('expenses.receiptAttached')}</p>
            <p className="flex items-center gap-1.5 text-sm text-fg-muted">
              {reading ? (
                <>
                  <Spinner className="size-3.5" />
                  {t('expenses.reading')}
                </>
              ) : (
                `${Math.max(1, Math.round(photo!.size / 1024))} KB`
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPhoto(null)}
            aria-label={t('expenses.removeReceipt')}
            className="focus-ring flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-5" />
          </button>
        </div>
      ) : (
        <Button variant="secondary" block onClick={() => fileInput.current?.click()} icon={<Camera className="size-5" />}>
          {editing?.hasReceipt ? t('expenses.replaceReceipt') : t('expenses.addReceipt')}
        </Button>
      )}

      {ocr && (
        <p className="flex gap-2.5 rounded-2xl bg-accent-soft px-4 py-3 text-sm font-medium text-accent-text">
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          {t('expenses.ocrNotice')}
        </p>
      )}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('expenses.category')}</legend>
        <div className="grid grid-cols-4 gap-2">
          {EXPENSE_CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICON[c];
            const active = category === c && !customId;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCategory(c);
                  setCustomId(null);
                  setAmountError(false);
                }}
                className={cn(
                  'focus-ring flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center transition-colors',
                  active ? 'bg-accent-soft ring-2 ring-accent' : 'edge bg-surface hover:bg-surface-2',
                )}
              >
                <span className="flex size-9 items-center justify-center rounded-xl text-white" style={{ backgroundColor: CATEGORY_COLOR[c] }}>
                  <Icon className="size-5" />
                </span>
                <span className="w-full truncate text-xs font-semibold">{t(`expenses.cat_${c}`)}</span>
              </button>
            );
          })}
        </div>
        {customCategories.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {customCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={customId === c.id}
                onClick={() => {
                  setCustomId(c.id);
                  setCategory(c.baseCategory);
                }}
                className={cn(
                  'focus-ring h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
                  customId === c.id ? 'bg-accent text-accent-fg' : 'edge bg-surface text-fg-muted hover:bg-surface-2',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      {mileage ? (
        <div>
          <Field
            label={t('expenses.km')}
            inputMode="decimal"
            value={km}
            onChange={(e) => {
              setKm(e.target.value);
              setAmountError(false);
            }}
            error={amountError ? t('expenses.kmError') : undefined}
            hint={t('expenses.kmHint', {
              rate: formatMoney(config.mileageRatePerKm, config.currency, lang),
              total: formatMoney(mileageAmount, config.currency, lang),
            })}
            placeholder="0"
            className="[&_input]:text-2xl [&_input]:font-bold [&_input]:tabular-nums"
          />
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_7.5rem] gap-3">
          <Field
            label={t('expenses.amount', { currency: config.currency })}
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              touched.current.amount = true;
              setAmount(e.target.value);
              setAmountError(false);
            }}
            error={amountError ? t('expenses.amountError') : undefined}
            placeholder="0,00"
            className="[&_input]:text-2xl [&_input]:font-bold [&_input]:tabular-nums"
          />
          <Field
            label={t('expenses.tax')}
            inputMode="decimal"
            value={tax}
            onChange={(e) => {
              touched.current.tax = true;
              setTax(e.target.value);
            }}
            placeholder={t('expenses.optional')}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t('manual.date')}
          type="date"
          value={date}
          max={isoDate(new Date())}
          onChange={(e) => {
            touched.current.date = true;
            setDate(e.target.value);
          }}
          required
        />
        <Field
          label={t('expenses.merchant')}
          value={merchant}
          onChange={(e) => {
            touched.current.merchant = true;
            setMerchant(e.target.value);
          }}
          placeholder={t('expenses.optional')}
          maxLength={120}
        />
      </div>

      {!mileage && (
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('expenses.payment')}</p>
          <Segmented
            label={t('expenses.payment')}
            value={payment}
            onChange={setPayment}
            options={[
              { value: 'EMPLOYEE_PAID', label: t('expenses.pay_EMPLOYEE_PAID') },
              { value: 'COMPANY_CARD', label: t('expenses.pay_COMPANY_CARD') },
            ]}
          />
        </div>
      )}

      {(locations.data?.length ?? 0) > 0 && (
        <div>
          <label htmlFor="exp-location" className="mb-1.5 block text-sm font-medium">
            {t('expenses.location')}
          </label>
          <select id="exp-location" value={locationId} onChange={(e) => setLocationId(e.target.value)} className={selectClass}>
            <option value="">{t('manual.noLocation')}</option>
            {locations.data!
              .filter((l) => l.isActive || l.id === locationId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </div>
      )}

      <Field label={t('expenses.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('expenses.optional')} maxLength={500} />

      <Button type="submit" size="lg" block loading={save.isPending}>
        {editing ? (editing.status === 'REJECTED' ? t('expenses.resubmit') : t('common.save')) : t('expenses.save')}
      </Button>
    </form>
  );
}
