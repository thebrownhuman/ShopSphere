import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cx, discountPercent, formatCount, formatPrice } from './format';

/*
 * Stateless primitives only: this package compiles to CommonJS with tsc, which cannot keep a
 * leading 'use client' directive, so anything with hooks lives in apps/web.
 * Colour classes rely on the tokens in apps/web/tailwind.config.js (all >= 4.5:1 contrast).
 */

type Variant = 'primary' | 'buy' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-cta text-slate-900 hover:bg-cta-dark',
  buy: 'bg-accent-dark text-white hover:bg-accent-darker',
  secondary: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
  ghost: 'text-brand-dark hover:bg-slate-100',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    />
  );
}

/** Five-star rating; the visual stars are hidden from AT and replaced by one text label. */
export function RatingStars({
  rating,
  count,
  size = 'sm',
}: {
  rating: number;
  count?: number;
  size?: 'sm' | 'md';
}) {
  const pct = Math.max(0, Math.min(5, rating)) * 20;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="sr-only">
        {rating.toFixed(1)} out of 5 stars{count !== undefined ? `, ${count} ratings` : ''}
      </span>
      <span
        aria-hidden="true"
        className={cx('relative inline-block leading-none', size === 'sm' ? 'text-sm' : 'text-lg')}
      >
        <span className="text-slate-300">★★★★★</span>
        <span
          className="absolute inset-0 overflow-hidden whitespace-nowrap text-amber-500"
          style={{ width: `${pct}%` }}
        >
          ★★★★★
        </span>
      </span>
      {count !== undefined && (
        <span aria-hidden="true" className="text-sm text-brand-dark">
          {formatCount(count)}
        </span>
      )}
    </span>
  );
}

/** Selling price, struck MRP and % off. All amounts are integer paise. */
export function Price({
  price,
  mrp,
  size = 'md',
  className,
}: {
  price: number;
  mrp?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const off = mrp ? discountPercent(price, mrp) : 0;
  const main = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl' }[size];
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-2', className)}>
      {off > 0 && (
        <span className={cx('font-medium text-deal', size === 'lg' ? 'text-2xl' : 'text-sm')}>
          -{off}%
        </span>
      )}
      <span className={cx('font-semibold text-slate-900', main)} data-testid="price">
        {formatPrice(price)}
      </span>
      {off > 0 && mrp && (
        <span className="text-sm text-slate-600">
          M.R.P.: <s>{formatPrice(mrp)}</s>
          <span className="sr-only">, {off} percent off</span>
        </span>
      )}
    </span>
  );
}

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'plus' | 'deal' | 'sponsored' }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-800',
    plus: 'bg-brand-dark text-white',
    deal: 'bg-deal text-white',
    sponsored: 'text-slate-600',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
      {...rest}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('block animate-pulse rounded bg-slate-200', className)}
    />
  );
}

/** Horizontal progress bar, e.g. "% claimed" on deals. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
    >
      <span className="block h-full bg-deal" style={{ width: `${v}%` }} />
    </span>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className,
  headingId,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headingId?: string;
}) {
  return (
    <section className={cx('bg-white p-4', className)} aria-labelledby={headingId}>
      {(title || action) && (
        <div className="mb-3 flex items-baseline justify-between gap-4">
          {title && (
            <h2 id={headingId} className="text-xl font-bold">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
