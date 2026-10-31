'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { payApi, PaymentStatus, ProviderName } from '../pay-api';

const POLL_MS = 2_000;
const POLL_LIMIT_MS = 5 * 60 * 1000;

/**
 * Return page (`/checkout/result` stand-in). Verifies the redirect signature, then polls status:
 * the order is paid only once the server has processed the signed webhook.
 */
function Result() {
  const q = useSearchParams();
  const orderId = q.get('orderId') ?? '';
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState<string | null>(q.get('error_description'));
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    let stopped = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const s = await payApi.status(orderId);
        if (stopped) return;
        setStatus(s);
        if (s.state === 'PAID') return;
        if (q.get('error_code') && s.state !== 'PENDING') return;
      } catch {
        // keep polling; transient errors are expected while the API restarts
      }
      if (Date.now() - started > POLL_LIMIT_MS) return setTimedOut(true);
      timer = setTimeout(poll, POLL_MS);
    };

    const paymentId = q.get('payment_id');
    const signature = q.get('signature');
    const providerOrderId = q.get('order_id');
    const verify =
      paymentId && signature && providerOrderId
        ? payApi
            .verify(orderId, {
              provider: (q.get('provider') ?? 'bank') as ProviderName,
              providerOrderId,
              providerPaymentId: paymentId,
              signature,
            })
            .catch((err: Error) => setError(err.message))
        : Promise.resolve();
    void verify.then(poll);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [orderId, q]);

  const state = status?.state;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-4 text-2xl font-bold">
        {state === 'PAID'
          ? 'Payment successful'
          : state === 'FAILED' || (error && state !== 'PENDING')
            ? 'Payment failed'
            : 'Confirming your payment…'}
      </h1>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {timedOut && state !== 'PAID' && (
        <p className="mb-3 text-sm text-slate-600">
          Still pending. We will keep checking with the bank and update your order.
        </p>
      )}
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <p>
          Order <code>{orderId}</code>: <b>{state ?? '…'}</b>
        </p>
        <ul className="mt-2 space-y-1">
          {status?.attempts.map((a) => (
            <li key={a.providerPaymentId}>
              <code>{a.providerPaymentId}</code> {a.method ?? ''} {a.status}
              {a.errorReason ? ` (${a.errorReason})` : ''}
            </li>
          ))}
          {status?.refunds.map((r) => (
            <li key={r.id}>
              Refund {r.amountPaise} paise ({r.reason}): {r.status}
            </li>
          ))}
        </ul>
      </section>
      <Link href="/dev/pay" className="mt-6 inline-block text-blue-700 underline">
        {state === 'FAILED' ? 'Retry with another method' : 'New payment'}
      </Link>
    </main>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<main className="p-10">Loading…</main>}>
      <Result />
    </Suspense>
  );
}
