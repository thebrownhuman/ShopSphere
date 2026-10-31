'use client';

import { formatPaise } from '@shopsphere/ui';
import { useEffect, useState } from 'react';
import { payApi, ProviderName } from './pay-api';

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  handler: (r: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (opts: RazorpayOptions) => { open: () => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay checkout'));
    document.body.appendChild(s);
  });
}

/** Dev-only playground: stub order -> initiate -> gateway checkout -> /dev/pay/result. */
export default function DevPayPage() {
  const [providers, setProviders] = useState<ProviderName[]>([]);
  const [provider, setProvider] = useState<ProviderName>('bank');
  const [rupees, setRupees] = useState('499');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    payApi
      .providers()
      .then((r) => setProviders(r?.providers ?? []))
      .catch(() => setProviders([]));
  }, []);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const amountPaise = Math.round(Number(rupees) * 100);
      const order = await payApi.createStubOrder(amountPaise);
      const returnUrl = `${window.location.origin}/dev/pay/result?provider=${provider}&orderId=${order.orderId}`;
      const init = await payApi.initiate(order.orderId, provider, returnUrl);

      if (init.checkout.kind === 'redirect') {
        window.location.assign(init.checkout.url);
        return;
      }
      const { keyId, providerOrderId, amountPaise: amount, currency } = init.checkout;
      await loadRazorpay();
      new window.Razorpay!({
        key: keyId,
        order_id: providerOrderId,
        amount,
        currency,
        name: 'ShopSphere (test mode)',
        handler: (r) => {
          const q = new URLSearchParams({
            provider,
            orderId: order.orderId,
            order_id: r.razorpay_order_id,
            payment_id: r.razorpay_payment_id,
            signature: r.razorpay_signature,
          });
          window.location.assign(`/dev/pay/result?${q}`);
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start payment');
      setBusy(false);
    }
  }

  const amountValid = Number(rupees) >= 1;

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold">Payment playground</h1>
      <p className="mb-6 text-sm text-slate-600">
        Dev only. Creates a stub order and pays it through a real gateway flow. Card details are
        entered on the gateway page, never here.
      </p>
      <form onSubmit={pay} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm">
          Amount (₹)
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            inputMode="decimal"
            value={rupees}
            onChange={(e) => setRupees(e.target.value)}
          />
          {amountValid && (
            <span className="text-xs text-slate-500">
              {formatPaise(Math.round(Number(rupees) * 100))}
            </span>
          )}
        </label>
        <fieldset className="text-sm">
          <legend className="mb-1">Gateway</legend>
          {(['bank', 'razorpay'] as const).map((p) => {
            const enabled = providers.includes(p);
            return (
              <label
                key={p}
                className={`mr-4 inline-flex items-center gap-2 ${enabled ? '' : 'opacity-50'}`}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={provider === p}
                  disabled={!enabled}
                  onChange={() => setProvider(p)}
                />
                {p === 'bank' ? 'ShopSphere Bank' : 'Razorpay (test)'}
                {!enabled && p === 'razorpay' && <span className="text-xs">(no keys)</span>}
              </label>
            );
          })}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          disabled={busy || !amountValid || !providers.includes(provider)}
          className="w-full rounded bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Opening checkout…' : 'Pay'}
        </button>
      </form>
    </main>
  );
}
