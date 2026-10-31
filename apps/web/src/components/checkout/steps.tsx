'use client';

import { Button, cx, formatPaise } from '@shopsphere/ui';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type {
  CheckoutAddress,
  CheckoutPatch,
  CheckoutSession,
  DeliverySpeed,
  NewAddress,
  PaymentMethod,
} from '@/lib/api/checkout.types';
import { formatDeliveryDate } from '@/lib/delivery';

/** Applies a patch; resolves to an error message or null. */
export type Apply = (patch: CheckoutPatch) => Promise<string | null>;

/** Collapsible step shell (PRD §8: single page, three collapsible steps). */
export function StepSection({
  n,
  title,
  open,
  summary,
  onChange,
  children,
}: {
  n: number;
  title: string;
  open: boolean;
  summary?: ReactNode;
  onChange?: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded bg-white shadow-sm"
      data-testid={`step-${n}`}
      data-open={open}
    >
      <div className={cx('flex items-start gap-3 px-4 py-3', open && 'bg-brand-navy text-white')}>
        <span
          className={cx(
            'mt-0.5 rounded-sm px-1.5 text-xs font-bold',
            open ? 'bg-white text-brand-navy' : 'bg-slate-200 text-slate-700',
          )}
        >
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-bold uppercase tracking-wide">
            {title}
          </h2>
          {!open && summary && <div className="mt-1 text-sm text-slate-700">{summary}</div>}
        </div>
        {!open && onChange && (
          <Button size="sm" variant="secondary" onClick={onChange} aria-label={`Change ${title}`}>
            Change
          </Button>
        )}
      </div>
      {open && <div className="p-4">{children}</div>}
    </section>
  );
}

export const addressLine = (a: CheckoutAddress) =>
  [a.line1, a.line2, a.landmark, `${a.city}, ${a.state} ${a.pincode}`].filter(Boolean).join(', ');

const EMPTY: NewAddress = {
  name: '',
  phone: '',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  state: '',
  pincode: '',
  type: 'HOME',
};

function AddressForm({ onSave, onCancel }: { onSave: Apply; onCancel: () => void }) {
  const [a, setA] = useState<NewAddress>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof NewAddress) => (e: { target: { value: string } }) =>
    setA((p) => ({ ...p, [k]: e.target.value }));
  const field = (k: keyof NewAddress, label: string, extra: Record<string, unknown> = {}) => (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
        value={(a[k] as string) ?? ''}
        onChange={set(k)}
        {...extra}
      />
    </label>
  );
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const msg = await onSave({
      newAddress: { ...a, line2: a.line2 || null, landmark: a.landmark || null },
    });
    setBusy(false);
    setError(msg);
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-label="New address">
      {field('name', 'Full name', { required: true, autoComplete: 'name' })}
      {field('phone', 'Mobile number', {
        required: true,
        inputMode: 'tel',
        autoComplete: 'tel',
        pattern: '\\+?[0-9]{10,13}',
      })}
      {field('pincode', 'Pincode', {
        required: true,
        inputMode: 'numeric',
        pattern: '[1-9][0-9]{5}',
        autoComplete: 'postal-code',
      })}
      {field('city', 'City', { required: true })}
      {field('state', 'State', { required: true })}
      {field('line1', 'Flat, house no., building', { required: true })}
      {field('line2', 'Area, street')}
      {field('landmark', 'Landmark')}
      <fieldset className="text-sm sm:col-span-2">
        <legend className="mb-1">Address type</legend>
        {(['HOME', 'WORK'] as const).map((t) => (
          <label key={t} className="mr-4 inline-flex items-center gap-2">
            <input
              type="radio"
              name="address-type"
              checked={a.type === t}
              onChange={() => setA((p) => ({ ...p, type: t }))}
            />
            {t === 'HOME' ? 'Home' : 'Work'}
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-deal sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="buy" disabled={busy}>
          Save and deliver here
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AddressStep({
  session,
  apply,
  onDone,
}: {
  session: CheckoutSession;
  apply: Apply;
  onDone: () => void;
}) {
  const [adding, setAdding] = useState(session.addresses.length === 0);
  const [error, setError] = useState<string | null>(null);
  const issue = session.issues.find((i) => i.code === 'NOT_SERVICEABLE');
  const pick = async (id: string) => setError(await apply({ addressId: id }));

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="sr-only">Saved addresses</legend>
        <ul className="space-y-2">
          {session.addresses.map((a) => (
            <li key={a.id}>
              <label className="flex cursor-pointer gap-3 rounded border border-slate-200 p-3 has-[:checked]:border-brand has-[:checked]:bg-blue-50">
                <input
                  type="radio"
                  name="address"
                  checked={session.addressId === a.id}
                  onChange={() => void pick(a.id)}
                />
                <span className="text-sm">
                  <b>{a.name}</b>{' '}
                  <span className="rounded bg-slate-100 px-1 text-xs">{a.type}</span> {a.phone}
                  <br />
                  {addressLine(a)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {issue && (
        <div role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold">{issue.message}</p>
          <ul className="my-1 list-disc pl-5">
            {session.shipments
              .flatMap((s) => s.items)
              .filter((i) => issue.lineIds.includes(i.lineId))
              .map((i) => (
                <li key={i.lineId}>{i.title}</li>
              ))}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => setError(await apply({ removeLineIds: issue.lineIds }))}
          >
            Remove undeliverable items
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-deal">
          {error}
        </p>
      )}
      {adding ? (
        <AddressForm
          onCancel={() => setAdding(false)}
          onSave={async (p) => {
            const msg = await apply(p);
            if (!msg) setAdding(false);
            return msg;
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAdding(true)}>
            + Add a new address
          </Button>
          <Button variant="buy" onClick={onDone} disabled={!session.addressId || !!issue}>
            Deliver here
          </Button>
        </div>
      )}
    </div>
  );
}

const METHOD_HELP: Record<PaymentMethod, string> = {
  BANK: 'You will enter card, UPI or bank details on the ShopSphere Bank secure page.',
  RAZORPAY: 'Pay with Razorpay Checkout (test mode).',
  COD: 'Pay in cash or UPI when the order arrives.',
  GIFT_CARD: 'Pay the whole order from your gift card balance.',
};

function CodeInput({
  label,
  placeholder,
  onApply,
}: {
  label: string;
  placeholder: string;
  onApply: (code: string) => Promise<string | null>;
}) {
  const id = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!code.trim()) return;
        setBusy(true);
        const msg = await onApply(code.trim());
        setBusy(false);
        setError(msg);
        if (!msg) setCode('');
      }}
    >
      <label htmlFor={id} className="block w-full text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm uppercase"
      />
      <Button type="submit" variant="secondary" disabled={busy || !code.trim()}>
        Apply
      </Button>
      {error && (
        <p id={`${id}-err`} role="alert" className="w-full text-sm text-deal">
          {error}
        </p>
      )}
    </form>
  );
}

export function PaymentStep({
  session,
  apply,
  onDone,
}: {
  session: CheckoutSession;
  apply: Apply;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const fullyCovered = session.price.total === 0;
  return (
    <div className="space-y-4">
      <fieldset disabled={fullyCovered}>
        <legend className="mb-2 text-sm font-semibold">Payment method</legend>
        <ul className="space-y-2">
          {session.methods.map((m) => (
            <li key={m.method}>
              <label
                className={cx(
                  'flex gap-3 rounded border border-slate-200 p-3 has-[:checked]:border-brand has-[:checked]:bg-blue-50',
                  m.enabled ? 'cursor-pointer' : 'opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="payment-method"
                  value={m.method}
                  disabled={!m.enabled}
                  checked={session.paymentMethod === m.method}
                  onChange={async () => setError(await apply({ paymentMethod: m.method }))}
                />
                <span className="text-sm">
                  <b>{m.label}</b>
                  <br />
                  <span className="text-slate-600">
                    {m.enabled ? METHOD_HELP[m.method] : m.reason}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-deal">
          {error}
        </p>
      )}
      <div className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
        <div>
          {session.coupon ? (
            <p className="text-sm">
              Coupon <b>{session.coupon.code}</b> applied: −{formatPaise(session.coupon.discount)}{' '}
              <button
                type="button"
                className="text-brand-dark underline"
                onClick={async () => setError(await apply({ couponCode: null }))}
              >
                Remove
              </button>
            </p>
          ) : (
            <CodeInput
              label="Coupon code"
              placeholder="e.g. SAVE200"
              onApply={(c) => apply({ couponCode: c })}
            />
          )}
        </div>
        <div className="space-y-2">
          <CodeInput
            label="Gift card"
            placeholder="Gift card code"
            onApply={(c) => apply({ giftCardCode: c })}
          />
          {session.giftCard && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={session.giftCard.applied > 0}
                onChange={async (e) =>
                  setError(await apply({ useGiftCardBalance: e.target.checked }))
                }
              />
              Use gift card balance ({formatPaise(session.giftCard.balance)})
            </label>
          )}
        </div>
      </div>
      <Button variant="buy" onClick={onDone} disabled={!fullyCovered && !session.paymentMethod}>
        Continue
      </Button>
    </div>
  );
}

export function ReviewStep({ session, apply }: { session: CheckoutSession; apply: Apply }) {
  const [error, setError] = useState<string | null>(null);
  const choose = async (shipmentId: string, speed: DeliverySpeed, slot?: string | null) =>
    setError(await apply({ delivery: { shipmentId, speed, slot } }));

  return (
    <div className="space-y-4">
      {session.shipments.map((sh, i) => {
        const selected = sh.options.find((o) => o.speed === sh.selected);
        return (
          <article
            key={sh.id}
            className="rounded border border-slate-200"
            aria-label={`Shipment ${i + 1} of ${session.shipments.length}`}
            data-testid="shipment"
          >
            <header className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <b>
                Shipment {i + 1} of {session.shipments.length}
              </b>{' '}
              · Sold by {sh.sellerName}
              {selected && (
                <span className="block font-semibold text-green-800">
                  Delivery by {formatDeliveryDate(selected.deliveryDate)}
                  {sh.slot ? `, ${sh.slot}` : ''}
                </span>
              )}
            </header>
            <ul className="divide-y divide-slate-100">
              {sh.items.map((it) => (
                <li key={it.lineId} className="flex justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    {it.title}
                    {it.qty > 1 && <span className="text-slate-600"> × {it.qty}</span>}
                  </span>
                  <b>{formatPaise(it.lineTotal)}</b>
                </li>
              ))}
            </ul>
            <fieldset className="border-t border-slate-200 px-3 py-2">
              <legend className="sr-only">Delivery option for shipment {i + 1}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {sh.options.map((o) => (
                  <label key={o.speed} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`delivery-${sh.id}`}
                      checked={sh.selected === o.speed}
                      onChange={() => void choose(sh.id, o.speed)}
                    />
                    {o.label} ({o.fee === 0 ? 'FREE' : formatPaise(o.fee)})
                  </label>
                ))}
              </div>
              {sh.selected === 'SCHEDULED' && (
                <label className="mt-2 block text-sm">
                  Slot{' '}
                  <select
                    className="ml-1 rounded border border-slate-300 px-2 py-1"
                    value={sh.slot ?? ''}
                    onChange={(e) => void choose(sh.id, 'SCHEDULED', e.target.value)}
                  >
                    {(selected?.slots ?? []).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
            </fieldset>
          </article>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-deal">
          {error}
        </p>
      )}
    </div>
  );
}
