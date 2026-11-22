import { cn } from '../lib/cn';

const PALETTE = [
  'bg-[#e0e7ff] text-[#3730a3]',
  'bg-[#d1fae5] text-[#065f46]',
  'bg-[#fef3c7] text-[#92400e]',
  'bg-[#fce7f3] text-[#9d174d]',
  'bg-[#e0f2fe] text-[#075985]',
  'bg-[#ede9fe] text-[#5b21b6]',
];

const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

const hash = (s: string): number => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

interface Props {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  /** Cuadrado redondeado para espacios y empresas; círculo para personas. */
  shape?: 'circle' | 'square';
  className?: string;
}

const sizes = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' };

export function Avatar({ name, size = 'md', shape = 'circle', className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-bold select-none contrast:border-2 contrast:border-black',
        sizes[size],
        shape === 'circle' ? 'rounded-full' : 'rounded-xl',
        PALETTE[hash(name) % PALETTE.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
