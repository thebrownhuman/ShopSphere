'use client';

import { Button, formatPaise, Skeleton } from '@shopsphere/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { BUY_NOW_PREVIEW_KEY, checkoutApi, type CheckoutApi } from '@/lib/api/checkout';
import type {
  CheckoutPatch,
  CheckoutSession,
  CheckoutSource,
  PriceChange,
} from '@/lib/api/checkout.types';
import { openGateway, resultUrl } from '@/lib/gateway';
import { useRequester } from '@/lib/use-requester';
import { Modal } from '../modal';
import { PriceBreakdown } from './price-breakdown';
import { AddressStep, addressLine, PaymentStep, ReviewStep, StepSection } from './steps';

type Step = 'address' | 'payment' | 'review';

const errorText = (e: unknown) =>
  e instanceof ApiRequestError ? e.message : 'Something went wrong. Please try again.';

function sourceFrom(params: URLSearchParams): CheckoutSource {
  const sku = params.get('buyNow');
  if (!sku) return { type: 'CART' };
  let preview: Extract<CheckoutSource, { type: 'BUY_NOW' }>['preview'];
  try {
    preview = JSON.parse(sessionStorage.getItem(BUY_NOW_PREVIEW_KEY) ?? 'null') ?? undefined;
  } catch {
    preview = undefined;
  }
  return {
    type: 'BUY_NOW',
    sku,
    sellerId: params.get('seller') ?? undefined,
    qty: Math.max(1, Number(params.get('qty')) || 1),
    preview,
  };
}

/** Where a returning shopper with complete defaults lands: straight on Review (one-click order). */
function firstStep(s: CheckoutSession): Step {
  if (!s.addressId || s.issues.length) return 'address';
  if (!s.paymentMethod && s.price.total > 0) return 'payment';
  return 'review';
}

export function CheckoutFlow() {
  const params = useSearchParams();
  const { request, ready, needsSignIn } = useRequester();
  const api: CheckoutApi = useMemo(() => checkoutApi(request), [request]);
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [step, setStep] = useState<Step>('address');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [changes, setChanges] = useState<{ list: PriceChange[]; from: number } | null>(null);
  // One key per checkout total: a double click or a second tab replays the same order.
  const idemKey = useRef<string>('');
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    api
      .create(sourceFrom(params), { priceChangeOnce: params.get('mockPriceChange') === '1' })
      .then((s) => {
        setSession(s);
        setStep(firstStep(s));
        idemKey.current = crypto.randomUUID();
      })
      .catch((e) => setLoadError(errorText(e)));
  }, [ready, api, params]);

  const apply = useCallback(
    async (patch: CheckoutPatch): Promise<string | null> => {
      if (!session) return null;
      try {
        const next = await api.update(session.id, patch);
        if (next.price.total !== session.price.total) idemKey.current = crypto.randomUUID();
        setSession(next);
        return null;
      } catch (e) {
        return errorText(e);
      }
    },
    [api, session],
  );

  const place = async () => {
    if (!session) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await api.placeOrder(session.id, session.price.total, idemKey.current);
      if (res.status === 'PRICE_CHANGED') {
        setSession(res.checkout);
        idemKey.current = crypto.randomUUID();
        setChanges({ list: res.changes, from: res.previousTotal });
        setPlacing(false);
        return;
      }
      if (!res.paymentRequired) {
        window.location.assign(`/checkout/result?orderId=${encodeURIComponent(res.orderId)}`);
        return;
      }
      const provider = session.paymentMethod === 'RAZORPAY' ? 'razorpay' : 'bank';
      const init = await api.initiatePayment(
        res.orderId,
        provider,
        resultUrl(res.orderId, provider),
      );
      // Dismissing Razorpay leaves an unpaid order: the result page offers the retry.
      await openGateway(init.checkout, res.orderId, () =>
        window.location.assign(`/checkout/result?orderId=${encodeURIComponent(res.orderId)}`),
      );
    } catch (e) {
      setPlaceError(errorText(e));
      setPlacing(false);
    }
  };

  if (needsSignIn) {
    const back = `/checkout${params.toString() ? `?${params}` : ''}`;
    return (
      <div className="rounded bg-white p-6">
        <h1 className="mb-2 text-xl font-bold">Sign in to check out</h1>
        <p className="mb-4 text-sm text-slate-700">
          Use your mobile number and a one-time code; it takes a few seconds.
        </p>
        <Link
          href={`/signin?returnTo=${encodeURIComponent(back)}`}
          className="inline-block rounded-full bg-cta px-5 py-2 font-medium text-slate-900"
        >
          Sign in
        </Link>
      </div>
    );
  }
  if (loadError) {
    return (
      <div role="alert" className="rounded bg-white p-6">
        <p className="mb-3 font-semibold">{loadError}</p>
        <Link href="/cart" className="text-brand-dark underline">
          Back to cart
        </Link>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading checkout">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const address = session.addresses.find((a) => a.id === session.addressId);
  const method = session.methods.find((m) => m.method === session.paymentMethod);
  const itemCount = session.shipments.flatMap((s) => s.items).reduce((t, i) => t + i.qty, 0);
  const online =
    session.price.total > 0 &&
    (session.paymentMethod === 'BANK' || session.paymentMethod === 'RAZORPAY');
  const cta = online ? `Pay ${formatPaise(session.price.total)}` : 'Place Order';

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <h1 className="sr-only">Checkout</h1>
        <StepSection
          n={1}
          title="Delivery address"
          open={step === 'address'}
          onChange={() => setStep('address')}
          summary={address && `${address.name}, ${addressLine(address)}`}
        >
          <AddressStep session={session} apply={apply} onDone={() => setStep('payment')} />
        </StepSection>
        <StepSection
          n={2}
          title="Payment method"
          open={step === 'payment'}
          onChange={address ? () => setStep('payment') : undefined}
          summary={session.price.total === 0 ? 'Paid by gift card' : method?.label}
        >
          <PaymentStep session={session} apply={apply} onDone={() => setStep('review')} />
        </StepSection>
        <StepSection n={3} title="Review items and delivery" open={step === 'review'}>
          <ReviewStep session={session} apply={apply} />
        </StepSection>
      </div>
      <aside className="h-fit space-y-4 rounded bg-white p-4 shadow-sm lg:sticky lg:top-4">
        {step === 'review' && (
          <>
            <Button
              block
              size="lg"
              variant="buy"
              onClick={place}
              disabled={placing || session.issues.length > 0}
              aria-busy={placing}
              data-testid="place-order"
            >
              {placing ? 'Placing order…' : cta}
            </Button>
            {placeError && (
              <p role="alert" className="text-sm text-deal">
                {placeError}
              </p>
            )}
            <p className="text-xs text-slate-600">
              By placing your order you agree to ShopSphere&apos;s conditions of use.
            </p>
          </>
        )}
        <PriceBreakdown price={session.price} itemCount={itemCount} />
      </aside>
      {changes && (
        <Modal title="Prices have changed" onClose={() => setChanges(null)}>
          <p className="mb-2 text-sm">
            Some prices changed since you started checking out. Please review before paying.
          </p>
          <ul className="mb-3 space-y-1 text-sm" data-testid="price-changes">
            {changes.list.map((c) => (
              <li key={c.lineId}>
                {c.title}: <s>{formatPaise(c.from)}</s> → <b>{formatPaise(c.to)}</b>
              </li>
            ))}
          </ul>
          <p className="mb-4 text-sm">
            New total <b>{formatPaise(session.price.total)}</b> (was {formatPaise(changes.from)})
          </p>
          <div className="flex gap-2">
            <Button
              variant="buy"
              onClick={() => {
                setChanges(null);
                void place();
              }}
            >
              Confirm and continue
            </Button>
            <Button variant="ghost" onClick={() => setChanges(null)}>
              Review order
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
