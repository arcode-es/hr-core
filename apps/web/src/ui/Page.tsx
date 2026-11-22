import type { ReactNode } from 'react';

/** Cabecera de página coherente: título, subtítulo y acción principal a la derecha. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight lg:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-accent-soft text-accent-text [&>svg]:size-7">
        {icon}
      </span>
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-xs text-sm text-fg-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
