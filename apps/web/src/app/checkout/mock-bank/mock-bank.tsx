'use client';

import { Button, formatPaise } from '@shopsphere/ui';
import { useSearchParams } from 'next/navigation';
import { settleMockPayment } from '@/lib/api/checkout.mock';

/**
 * Mock "ShopSphere Bank" hosted page. Like the real bank-sim it settles the order server-side
 * (here: the mock store, standing in for the webhook) and then redirects to the return URL.
 * No card fields: the point is the redirect round trip, not data entry.
 */
export function MockBank() {
  const q = useSearchParams();
  const orderId = q.get('orderId') ?? '';
  const amount = Number(q.get('amount') ?? 0);
  const returnUrl = q.get('returnUrl') ?? '/checkout/result';

  const finish = (ok: boolean) => {
    const reason = 'Card declined by issuing bank (simulated)';
    settleMockPayment(orderId, ok, reason);
    const url = new URL(returnUrl, window.location.origin);
    if (url.origin !== window.location.origin) return; // never bounce to a foreign origin
    url.searchParams.set('orderId', orderId);
    if (ok) {
      url.searchParams.set('order_id', `bank_order_${orderId}`);
      url.searchParams.set('payment_id', `bank_pay_${Date.now()}`);
      url.searchParams.set('signature', 'mock');
    } else {
      url.searchParams.set('error_code', 'BAD_REQUEST_ERROR');
      url.searchParams.set('error_description', reason);
    }
    window.location.assign(url.toString());
  };

  return (
    <section className="rounded-lg border border-slate-300 bg-white p-6">
      <p className="text-xs uppercase tracking-wide text-slate-500">Mock gateway</p>
      <h1 className="mb-4 text-2xl font-bold">ShopSphere Bank</h1>
      <p className="mb-6">
        Pay <b>{formatPaise(amount)}</b> to ShopSphere for order <code>{orderId}</code>
      </p>
      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={() => finish(true)}>
          Approve payment
        </Button>
        <Button variant="secondary" onClick={() => finish(false)}>
          Decline payment
        </Button>
      </div>
    </section>
  );
}
