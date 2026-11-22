import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
}

/** Campo de texto con etiqueta, ayuda y error asociados para lectores de pantalla. */
export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, error, hint, icon, className, type = 'text', id, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const auto = useId();
  const fieldId = id ?? auto;
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';
  const describedBy = error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-fg">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-fg-subtle [&>svg]:size-[18px]">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={fieldId}
          type={isPassword && reveal ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'edge h-12 w-full rounded-control bg-surface px-3.5 text-base text-fg transition-colors placeholder:text-fg-subtle',
            'focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none',
            'disabled:bg-surface-2 disabled:text-fg-muted',
            icon && 'pl-11',
            isPassword && 'pr-12',
            error && 'border-danger focus:border-danger focus:ring-danger/20',
          )}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? t('common.hidePassword') : t('common.showPassword')}
            aria-pressed={reveal}
            className="focus-ring absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-control text-fg-subtle hover:text-fg"
          >
            {reveal ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${fieldId}-err`} role="alert" className="mt-1.5 text-sm font-medium text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-sm text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
