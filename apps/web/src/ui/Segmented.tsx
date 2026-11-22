import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface Option<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface Props<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
}

/** Selector de una opción entre pocas, visible de un vistazo. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('edge flex gap-1 rounded-control bg-surface-2 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-ring flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[0.625rem] px-2 text-sm font-semibold transition-colors [&>svg]:size-4',
              active
                ? 'bg-surface text-fg shadow-sm contrast:bg-black contrast:text-white'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
