'use client';

import { Button, formatPaise } from '@shopsphere/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { checkoutApi, CHECKOUT_MOCK, type GatewayProvider } from '@/lib/api/checkout';
import type { OrderPaymentStatus } from '@/lib/api/checkout.types';
import { API_URL } from '@/lib/api';
import { openGateway, resultUrl } from '@/lib/gateway';
import { useRequester } from '@/lib/use-requester';

const POLL_MS = 2_000;
/** After this long still pending, show the "Payment pending" page (polling continues). */
const PENDING_AFTER_MS = 20_000;
const POLL_LIMIT_MS = 5 * 60_000;

type View = 'confirming' | 'confirmed' | 'pending' | 'failed';

export function viewFor(s: OrderPaymentStatus | null, elapsedMs: number): View {
  if (!s) return 'confirming';
  if (s.status === 'CONFIRMED') return 'confirmed';
  if (s.status === 'PAYMENT_FAILED' || s.status === 'CANCELLED') return 'failed';
  return elapsedMs >= PENDING_AFTER_MS ? 'pending' : 'confirming';
}

/** Gateways the API has keys for. Mock: ShopSphere Bank only. */
function useProviders(): GatewayProvider[] {
  const [providers, setProviders] = useState<GatewayProvider[]>(['bank']);
  useEffect(() => {
    if (CHECKOUT_MOCK) return;
    fetch(`${API_URL}/payments/providers`)
      .then((r) => r.json() as Promise<{ providers: GatewayProvider[] }>)
      .then((r) => setProviders(r.providers))
      .catch(() => undefined);
  }, []);
  return providers;
}

function Retry({ orderId, retryUntil }: { orderId: string; retryUntil: string | null }) {
  const { request } = useRequester();
  const api = useMemo(() => checkoutApi(request), [request]);
  const providers = useProviders();
  const [provider, setProvider] = useState<GatewayProvider>('bank');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = retryUntil !== null && Date.parse(retryUntil) < Date.now();

  if (expired) {
    return (
      <p className="text-sm">
        The 15-minute retry window has closed and the items went back on sale. Your cart is
        unchanged, so you can{' '}
        <Link href="/cart" className="text-brand-dark underline">
          check out again
        </Link>
        .
      </p>
    );
  }
  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const init = await api.initiatePayment(orderId, provider, resultUrl(orderId, provider));
      await openGateway(init.checkout, orderId, () => setBusy(false));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not start payment');
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <fieldset className="text-sm">
        <legend className="mb-1 font-semibold">Try again with</legend>
        {(['bank', 'razorpay'] as const).map((p) => (
          <label
            key={p}
            className={`mr-4 inline-flex items-center gap-2 ${providers.includes(p) ? '' : 'opacity-50'}`}
          >
            <input
              type="radio"
              name="retry-provider"
              checked={provider === p}
              disabled={!providers.includes(p)}
              onChange={() => setProvider(p)}
            />
            {p === 'bank' ? 'ShopSphere Bank' : 'Razorpay'}
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-deal">
          {error}
        </p>
      )}
      <Button variant="buy" onClick={retry} disabled={busy} data-testid="retry-payment">
        {busy ? 'Opening payment…' : 'Retry payment'}
      </Button>
    </div>
  );
}

/**
 * /checkout/result (PRD §9 step 4): shows "Confirming your payment…" while polling the order;
 * the order is confirmed only once the server has processed the signed webhook, never on the
 * redirect alone. Ends on confirmation, payment pending, or payment failed + retry.
 */
export function OrderResult() {
  const q = useSearchParams();
  const orderId = q.get('orderId') ?? '';
  const { request, ready, needsSignIn } = useRequester();
  const api = useMemo(() => checkoutApi(request), [request]);
  const qc = useQueryClient();
  const [status, setStatus] = useState<OrderPaymentStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const gatewayError = q.get('error_description');

  useEffect(() => {
    if (!orderId || !ready) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const poll = async () => {
      try {
        const s = await api.status(orderId);
        if (stopped) return;
        setStatus(s);
        setElapsed(Date.now() - started);
        if (s.status !== 'PENDING_PAYMENT') return;
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 404) {
          setLoadError('We could not find that order.');
          return;
        }
        // transient: keep polling
      }
      if (Date.now() - started > POLL_LIMIT_MS) return setGaveUp(true);
      timer = setTimeout(poll, POLL_MS);
    };
    const paymentId = q.get('payment_id');
    const signature = q.get('signature');
    const providerOrderId = q.get('order_id');
    const verify =
      paymentId && signature && providerOrderId
        ? api
            .verifyRedirect(orderId, {
              provider: (q.get('provider') ?? 'bank') as GatewayProvider,
              providerOrderId,
              providerPaymentId: paymentId,
              signature,
            })
            .catch(() => undefined)
        : Promise.resolve();
    void verify.then(poll);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [orderId, ready, api, q]);

  const view = viewFor(status, elapsed);
  useEffect(() => {
    // Server clears the cart on confirmation; refetch so the header count follows.
    if (view === 'confirmed') void qc.invalidateQueries({ queryKey: ['cart'] });
  }, [view, qc]);

  if (!orderId || loadError) {
    return (
      <p role="alert" className="rounded bg-white p-6">
        {loadError ?? 'Missing order.'}{' '}
        <Link href="/orders" className="text-brand-dark underline">
          Your orders
        </Link>
      </p>
    );
  }
  if (needsSignIn) {
    return (
      <p className="rounded bg-white p-6">
        <Link
          href={`/signin?returnTo=${encodeURIComponent(`/checkout/result?orderId=${orderId}`)}`}
          className="text-brand-dark underline"
        >
          Sign in
        </Link>{' '}
        to see your order.
      </p>
    );
  }

  return (
    <section className="mx-auto max-w-xl rounded bg-white p-6" aria-live="polite" data-view={view}>
      {view === 'confirming' && (
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-4 border-brand border-t-transparent"
          />
          <h1 className="text-xl font-bold">Confirming your payment…</h1>
        </div>
      )}
      {view === 'confirmed' && status && (
        <>
          <h1 className="mb-1 text-2xl font-bold text-green-800">✓ Order placed, thank you!</h1>
          <p className="mb-4 text-sm text-slate-700">
            Confirmation will be sent to your email and phone.
          </p>
          <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt>Order number</dt>
            <dd className="font-semibold" data-testid="order-number">
              {status.orderNumber}
            </dd>
            <dt>{status.paymentState === 'NOT_REQUIRED' ? 'Amount due' : 'Amount paid'}</dt>
            <dd className="font-semibold">{formatPaise(status.amount)}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/orders/${encodeURIComponent(orderId)}`}
              className="rounded-full bg-cta px-5 py-2 font-medium text-slate-900"
            >
              View order
            </Link>
            <Link href="/" className="rounded-full border border-slate-300 px-5 py-2">
              Continue shopping
            </Link>
          </div>
        </>
      )}
      {view === 'pending' && (
        <>
          <h1 className="mb-2 text-2xl font-bold">Payment pending</h1>
          <p className="mb-2 text-sm">
            Your bank has not confirmed the payment yet. This can take a few minutes for UPI and net
            banking. Don&apos;t pay again; we&apos;ll update your order and notify you.
          </p>
          {gaveUp && (
            <p className="mb-2 text-sm text-slate-600">
              We&apos;ll keep checking with the bank for up to 24 hours. If the money is debited and
              the order is not confirmed, it is refunded automatically.
            </p>
          )}
          <Link
            href={`/orders/${encodeURIComponent(orderId)}`}
            className="text-brand-dark underline"
          >
            Track this order
          </Link>
        </>
      )}
      {view === 'failed' && status && (
        <>
          <h1 className="mb-2 text-2xl font-bold text-deal">Payment failed</h1>
          <p className="mb-4 text-sm">
            {status.failureReason ?? gatewayError ?? 'The payment did not go through.'} No money was
            taken for order <b>{status.orderNumber}</b>; if it was, it is refunded automatically.
          </p>
          {status.status === 'PAYMENT_FAILED' ? (
            <Retry orderId={orderId} retryUntil={status.retryUntil} />
          ) : (
            <Link href="/cart" className="text-brand-dark underline">
              Back to cart
            </Link>
          )}
        </>
      )}
    </section>
  );
}
