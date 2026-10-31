'use client';

import { Button } from '@shopsphere/ui';
import { useId, useRef, useState, type FormEvent } from 'react';
import { isValidPincode, usePincode } from '@/lib/pincode';

/** "Deliver to <pincode>" with a native <dialog> modal (focus trap + Esc for free). */
export function PincodeButton({ variant = 'header' }: { variant?: 'header' | 'inline' }) {
  const { pincode, chosen, setPincode } = usePincode();
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const uid = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPincode(value)) {
      setError('Enter a valid 6-digit pincode');
      return;
    }
    setPincode(value);
    ref.current?.close();
  }

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          onClick={() => {
            setValue(chosen ? pincode : '');
            setError(null);
            ref.current?.showModal();
          }}
          className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-left hover:outline hover:outline-1 hover:outline-white"
          data-testid="pincode-button"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
          </svg>
          <span className="leading-tight">
            <span className="block text-xs opacity-90">{chosen ? 'Deliver to' : 'Hello'}</span>
            <span className="block text-sm font-semibold">
              {chosen ? pincode : 'Select your pincode'}
            </span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          className="text-sm font-medium text-brand-dark underline"
          onClick={() => {
            setValue(pincode);
            setError(null);
            ref.current?.showModal();
          }}
        >
          Deliver to {pincode} – change
        </button>
      )}
      <dialog
        ref={ref}
        aria-labelledby={`${uid}-title`}
        className="w-[min(92vw,26rem)] rounded-lg p-0 text-slate-900 backdrop:bg-black/50"
      >
        <form onSubmit={submit} className="p-5">
          <h2 id={`${uid}-title`} className="mb-1 text-lg font-bold">
            Choose your location
          </h2>
          <p className="mb-4 text-sm text-slate-700">
            Delivery dates and availability depend on your pincode.
          </p>
          <label htmlFor={`${uid}-input`} className="mb-1 block text-sm font-medium">
            Pincode
          </label>
          <input
            id={`${uid}-input`}
            inputMode="numeric"
            maxLength={6}
            autoComplete="postal-code"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
            aria-invalid={!!error}
            aria-describedby={error ? `${uid}-error` : undefined}
            className="mb-1 h-10 w-full rounded border border-slate-400 px-3"
          />
          <p id={`${uid}-error`} role="alert" className="mb-3 min-h-5 text-sm text-deal">
            {error}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => ref.current?.close()}>
              Cancel
            </Button>
            <Button type="submit">Apply</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
