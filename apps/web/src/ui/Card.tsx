import type { HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('edge rounded-card bg-surface/80 shadow-card backdrop-blur-sm', className)} {...rest} />;
}

export function SectionTitle({ className, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn('font-mono text-[11px] font-medium tracking-[0.08em] text-fg-subtle uppercase', className)} {...rest} />
  );
}
