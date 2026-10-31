'use client';

import { Button, Price, Skeleton, formatPrice } from '@shopsphere/ui';
import { useEffect, useId, useState } from 'react';
import { countdown, formatDeliveryDate } from '@/lib/delivery';
import { AddToCartButton } from '../cart/add-to-cart-button';
import { PincodeButton } from '../header/pincode-button';
import { useDelivery, useOffers, usePdp } from './pdp-context';

function DeliveryPromise() {
  const { data: est, isLoading } = useDelivery();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (isLoading) return <Skeleton className="h-10 w-full" />;
  if (!est || !est.serviceable) {
    return <p className="text-sm font-medium text-deal">Not deliverable to this pincode</p>;
  }
  const left = now ? countdown(new Date(est.cutoffAt), now) : null;
  return (
    <p className="text-sm" data-testid="delivery-promise">
      {est.free ? 'FREE delivery' : 'Delivery'} <b>{formatDeliveryDate(est.deliverBy)}</b>.
      {left && (
        <>
          {' '}
          Order within <span className="font-semibold text-green-800">{left}</span>.
        </>
      )}
    </p>
  );
}

/** Buy Now and wishlist arrive with M4. */
const notYet = () => {};

/** PRD §6 right column: sticky buy box; everything inside is fetched live (no-store). */
export function BuyBox() {
  const { product } = usePdp();
  const { data, isLoading } = useOffers();
  const qtyId = useId();
  const [qty, setQty] = useState(1);
  const offer = data?.buyBox;
  const maxQty = offer ? Math.min(offer.maxPerOrder, offer.stockQty) : 1;
  useEffect(() => setQty(1), [offer?.id]);

  return (
    <aside
      aria-label="Buy box"
      className="space-y-3 rounded-lg border border-slate-300 bg-white p-4 lg:sticky lg:top-32"
      data-testid="buy-box"
    >
      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : offer ? (
        <>
          <Price price={offer.price} size="md" />
          <DeliveryPromise />
          <PincodeButton variant="inline" />
          <p
            className={
              offer.stockQty <= 5 ? 'font-semibold text-deal' : 'font-semibold text-green-800'
            }
            data-testid="stock-status"
          >
            {offer.stockQty <= 5 ? `Only ${offer.stockQty} left in stock.` : 'In stock'}
          </p>
          <label htmlFor={qtyId} className="flex items-center gap-2 text-sm">
            Quantity:
            <select
              id={qtyId}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="h-8 rounded-md border border-slate-300 bg-slate-50 px-2"
            >
              {Array.from({ length: maxQty }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <AddToCartButton
            block
            sku={offer.skuId}
            sellerId={offer.sellerId}
            qty={qty}
            price={offer.price}
          />
          <Button block variant="buy" onClick={notYet} data-testid="buy-now">
            Buy Now
          </Button>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-700">
            <dt>Ships from</dt>
            <dd className="text-slate-900">
              {offer.fulfilment === 'SHOPSPHERE' ? 'ShopSphere' : offer.sellerName}
            </dd>
            <dt>Sold by</dt>
            <dd className="text-slate-900">
              {offer.sellerName}{' '}
              <span className="text-slate-600">({offer.sellerRating.toFixed(1)}★)</span>
            </dd>
            <dt>Returns</dt>
            <dd className="text-slate-900">{product.returnPolicy}</dd>
            <dt>Payment</dt>
            <dd className="text-slate-900">🔒 Secure transaction</dd>
          </dl>
          {offer.fulfilment === 'SHOPSPHERE' && (
            <p className="text-xs font-semibold text-brand-dark">✓ Fulfilled by ShopSphere</p>
          )}
        </>
      ) : (
        <>
          <p className="text-lg font-semibold text-deal">Currently unavailable.</p>
          <p className="text-sm text-slate-700">
            We don&apos;t know when or if this item will be back in stock.
          </p>
          <Button block variant="secondary" onClick={notYet}>
            Notify me
          </Button>
        </>
      )}
      <Button block variant="secondary" size="sm" onClick={notYet}>
        Add to Wishlist
      </Button>
      {data && data.others.length > 0 && (
        <details className="border-t border-slate-200 pt-3 text-sm">
          <summary className="cursor-pointer">
            Other sellers from <b>{formatPrice(Math.min(...data.others.map((o) => o.price)))}</b>
          </summary>
          <ul className="mt-2 space-y-2">
            {data.others.map((o) => (
              <li key={o.id} className="flex justify-between gap-2">
                <span>
                  {o.sellerName} ({o.sellerRating.toFixed(1)}★)
                </span>
                <b>{formatPrice(o.price)}</b>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}

/** Mobile sticky bottom bar (PRD §6 mobile web). */
export function MobileBuyBar() {
  const { data } = useOffers();
  const offer = data?.buyBox;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-slate-300 bg-white p-2 shadow-[0_-2px_8px_rgba(0,0,0,.08)] lg:hidden"
      data-testid="mobile-buy-bar"
    >
      {offer ? (
        <>
          <span className="min-w-0 shrink-0 text-lg font-semibold">{formatPrice(offer.price)}</span>
          <AddToCartButton
            className="flex-1"
            block
            sku={offer.skuId}
            sellerId={offer.sellerId}
            price={offer.price}
            data-testid="mobile-add-to-cart"
            errorClassName="absolute bottom-full mb-1 rounded bg-white px-2 py-1 shadow"
          />
          <Button className="flex-1" variant="buy" onClick={notYet}>
            Buy Now
          </Button>
        </>
      ) : (
        <Button block variant="secondary" onClick={notYet} disabled={!data}>
          {data ? 'Notify me' : 'Loading…'}
        </Button>
      )}
    </div>
  );
}
