'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { ApiRequestError } from '@/lib/api';

/** Small form primitives for auth/account pages until the M0.6 design system lands. */

export function Field({
  label,
  error,
  hint,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
  id: string;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="w-full rounded border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 aria-[invalid]:border-red-500"
        {...props}
      />
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function Button({
  variant = 'primary',
  busy,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  const styles = {
    primary: 'bg-accent text-white hover:brightness-95 shadow-sm',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
    ghost: 'text-brand hover:underline',
    danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  }[variant];
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center rounded px-4 py-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy ? 'Please wait…' : children}
    </button>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {error}
    </div>
  );
}

export function errorMessage(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (err instanceof ApiRequestError) return err.body?.message ?? fallback;
  return fallback;
}

/** Map a password to 0–4 for the strength meter (length + character variety). */
export function passwordStrength(pw: string): number {
  if (!pw) return 0;
  let score = pw.length >= 8 ? 1 : 0;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

export function StrengthMeter({ password }: { password: string }) {
  const score = passwordStrength(password);
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  const colors = ['bg-slate-200', 'bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-green-600'];
  return (
    <div className="-mt-2 mb-4" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded ${i <= score ? colors[score] : 'bg-slate-200'}`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-600">Password strength: {labels[score]}</p>
    </div>
  );
}
