import { cx } from '@shopsphere/ui';
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export const inputClass =
  'h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

/** Labelled input with an inline error announced via aria-describedby. */
export function Field({
  label,
  error,
  hint,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={cx(inputClass, error && 'border-deal')}
        {...input}
      />
      {(error || hint) && (
        <p id={`${id}-msg`} className={cx('mt-1 text-xs', error ? 'text-deal' : 'text-slate-500')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Alert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'ok';
}) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded border px-3 py-2 text-sm',
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-deal'
          : 'border-green-200 bg-green-50 text-green-800',
      )}
    >
      {children}
    </p>
  );
}
