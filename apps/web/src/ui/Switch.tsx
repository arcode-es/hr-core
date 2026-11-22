/** Interruptor accesible (checkbox con role="switch") con etiqueta y ayuda opcional. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="relative flex cursor-pointer items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-fg-muted">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative h-8 w-14 shrink-0 rounded-full bg-border-strong transition-colors peer-checked:bg-success peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--ring) peer-disabled:opacity-50 after:absolute after:top-1 after:left-1 after:size-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-6" />
    </label>
  );
}

/** Mismo aspecto que Field para los controles nativos. */
export const selectClass =
  'edge h-12 w-full rounded-control bg-surface px-3 text-base text-fg focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none';
export const textareaClass =
  'edge min-h-28 w-full rounded-control bg-surface px-3.5 py-3 text-base text-fg placeholder:text-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none';
