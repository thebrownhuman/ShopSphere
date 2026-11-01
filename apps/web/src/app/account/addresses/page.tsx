'use client';

import type { Address, AddressInput, PincodeInfo } from '@shopsphere/types';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBanner, Field, errorMessage } from '@/components/form';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const EMPTY: AddressInput = {
  name: '',
  phone: '',
  line1: '',
  line2: null,
  landmark: null,
  city: '',
  state: '',
  pincode: '',
  type: 'home',
};

export default function AddressesPage() {
  const { request } = useAuth();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAddresses((await request<Address[]>('/me/addresses')) ?? []);
    } catch (err) {
      setAddresses([]);
      setError(errorMessage(err));
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <nav className="mb-2 text-sm">
        <Link href="/account" className="text-brand hover:underline">
          Your Account
        </Link>{' '}
        › Your Addresses
      </nav>
      <h1 className="mb-4 text-2xl font-bold">Your Addresses</h1>
      <ErrorBanner error={error} />

      {editing ? (
        <AddressForm
          initial={editing === 'new' ? EMPTY : editing}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === 'new') await request('/me/addresses', { method: 'POST', body: input });
            else await request(`/me/addresses/${editing.id}`, { method: 'PATCH', body: input });
            setEditing(null);
            await load();
          }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            onClick={() => setEditing('new')}
            className="flex min-h-48 flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-slate-600 hover:border-brand hover:text-brand"
          >
            <span className="text-3xl" aria-hidden>
              +
            </span>
            <span className="font-semibold">Add address</span>
          </button>
          {addresses === null && <p className="text-slate-500">Loading…</p>}
          {addresses?.map((a) => (
            <article
              key={a.id}
              className="flex flex-col rounded-lg border border-slate-200 bg-white p-4"
              data-testid="address-card"
            >
              {a.isDefault && (
                <p className="mb-2 text-xs font-semibold uppercase text-brand">Default</p>
              )}
              <p className="font-semibold">
                {a.name}{' '}
                <span className="ml-1 rounded bg-slate-100 px-1.5 text-xs uppercase text-slate-600">
                  {a.type}
                </span>
              </p>
              <p className="text-sm text-slate-700">
                {a.line1}
                {a.line2 && <>, {a.line2}</>}
                <br />
                {a.landmark && <>Near {a.landmark}, </>}
                {a.city}, {a.state} {a.pincode}
                <br />
                Phone: {a.phone}
              </p>
              <div className="mt-auto flex flex-wrap gap-x-3 pt-3 text-sm">
                <button className="text-brand hover:underline" onClick={() => setEditing(a)}>
                  Edit
                </button>
                <button
                  className="text-brand hover:underline"
                  onClick={() =>
                    void act(() => request(`/me/addresses/${a.id}`, { method: 'DELETE' }))
                  }
                >
                  Remove
                </button>
                {!a.isDefault && (
                  <button
                    className="text-brand hover:underline"
                    onClick={() =>
                      void act(() => request(`/me/addresses/${a.id}/default`, { method: 'POST' }))
                    }
                  >
                    Set as default
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function AddressForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: AddressInput;
  onSave: (a: AddressInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AddressInput>(initial);
  const [pin, setPin] = useState<PincodeInfo | null>(null);
  const [pinError, setPinError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AddressInput>(k: K, v: AddressInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Pincode autofill: city/state + serviceability as soon as 6 digits are entered.
  useEffect(() => {
    if (!/^[1-9]\d{5}$/.test(form.pincode)) {
      setPin(null);
      setPinError(undefined);
      return;
    }
    let cancelled = false;
    apiGet<PincodeInfo>(`/pincodes/${form.pincode}`)
      .then((p) => {
        if (cancelled) return;
        setPin(p);
        setPinError(undefined);
        setForm((f) => ({ ...f, city: p.city, state: p.state }));
      })
      .catch(() => {
        if (!cancelled) {
          setPin(null);
          setPinError('Pincode not found. Enter city and state manually.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [form.pincode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      aria-label="Address"
      className="max-w-xl rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2 className="mb-4 text-lg font-semibold">
        {'id' in initial ? 'Edit address' : 'Add a new address'}
      </h2>
      <ErrorBanner error={error} />
      <Field
        id="addr-name"
        label="Full name"
        autoComplete="name"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        required
      />
      <Field
        id="addr-phone"
        label="Mobile number"
        inputMode="tel"
        autoComplete="tel-national"
        maxLength={10}
        value={form.phone}
        onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))}
        required
      />
      <Field
        id="addr-pincode"
        label="Pincode"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={6}
        value={form.pincode}
        onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))}
        error={pinError}
        hint={
          pin
            ? pin.serviceable
              ? `Delivers to ${pin.city}`
              : 'We do not deliver to this pincode yet'
            : undefined
        }
        required
      />
      <Field
        id="addr-line1"
        label="Flat, house no., building, street"
        autoComplete="address-line1"
        value={form.line1}
        onChange={(e) => set('line1', e.target.value)}
        required
      />
      <Field
        id="addr-line2"
        label="Area, locality (optional)"
        autoComplete="address-line2"
        value={form.line2 ?? ''}
        onChange={(e) => set('line2', e.target.value || null)}
      />
      <Field
        id="addr-landmark"
        label="Landmark (optional)"
        value={form.landmark ?? ''}
        onChange={(e) => set('landmark', e.target.value || null)}
      />
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field
          id="addr-city"
          label="City"
          autoComplete="address-level2"
          value={form.city}
          onChange={(e) => set('city', e.target.value)}
          required
        />
        <Field
          id="addr-state"
          label="State"
          autoComplete="address-level1"
          value={form.state}
          onChange={(e) => set('state', e.target.value)}
          required
        />
      </div>
      <fieldset className="mb-4">
        <legend className="mb-1 text-sm font-medium text-slate-700">Address type</legend>
        <div className="flex gap-4">
          {(['home', 'work', 'other'] as const).map((t) => (
            <label key={t} className="flex items-center gap-1 text-sm capitalize">
              <input
                type="radio"
                name="addr-type"
                checked={form.type === t}
                onChange={() => set('type', t)}
              />{' '}
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.isDefault ?? false}
          onChange={(e) => set('isDefault', e.target.checked)}
        />{' '}
        Make this my default address
      </label>
      <div className="flex gap-2">
        <Button type="submit" busy={busy}>
          Save address
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
