'use client';

import type { CartLine, CartResponse, SavedItem } from '@shopsphere/types';
import { Button, Price, ProgressBar, Skeleton, formatPrice } from '@shopsphere/ui';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { useCart, type CartResult } from '@/lib/cart';
import { formatDeliveryDate } from '@/lib/delivery';
import { CatalogImage } from '../catalog-image';

const variantText = (v: Record<string, string>) =>
  Object.entries(v)
    .map(([k, val]) => `${k[0]!.toUpperCase()}${k.slice(1)}: ${val}`)
    .join(' · ');

function Thumb({ image, slug }: { image: CartLine['image']; slug: string }) {
  const img = image ? (
    <CatalogImage
      image={{ url: image.small, alt: image.alt, width: 300, height: 300 }}
      className="h-24 w-24 object-contain sm:h-36 sm:w-36"
    />
  ) : (
    <span className="block h-24 w-24 bg-slate-100 sm:h-36 sm:w-36" />
  );
  return slug ? <Link href={`/p/${slug}`}>{img}</Link> : img;
}

/** PRD §7 change banners: "Price dropped from ₹1,299 to ₹1,199". */
function Banners({ lines }: { lines: CartLine[] }) {
  const notes: { id: string; text: string; tone: 'good' | 'warn' }[] = [];
  for (const l of lines) {
    if (l.priceChange) {
      const down = l.priceChange.to < l.priceChange.from;
      notes.push({
        id: `${l.id}-p`,
        tone: down ? 'good' : 'warn',
        text: `${l.title}: price ${down ? 'dropped' : 'increased'} from ${formatPrice(l.priceChange.from)} to ${formatPrice(l.priceChange.to)}`,
      });
    }
    if (l.stockChange === 'OUT_OF_STOCK')
      notes.push({ id: `${l.id}-s`, tone: 'warn', text: `${l.title} is now out of stock` });
    if (l.stockChange === 'UNAVAILABLE')
      notes.push({ id: `${l.id}-s`, tone: 'warn', text: `${l.title} is no longer available` });
    if (l.stockChange === 'LIMITED')
      notes.push({
        id: `${l.id}-s`,
        tone: 'warn',
        text: `${l.title}: only ${l.maxQty} can be bought now. Please reduce the quantity.`,
      });
  }
  if (notes.length === 0) return null;
  return (
    <ul className="mb-3 space-y-2" data-testid="cart-banners">
      {notes.map((n) => (
        <li
          key={n.id}
          role="status"
          className={
            n.tone === 'good'
              ? 'rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900'
              : 'rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900'
          }
        >
          {n.text}
        </li>
      ))}
    </ul>
  );
}

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const run = async (p: Promise<CartResult>) => {
    setError(null);
    const r = await p;
    if (!r.ok) setError(r.message);
  };
  return { error, run };
}

function LineRow({ line }: { line: CartLine }) {
  const { setQty, remove, saveForLater } = useCart();
  const { error, run } = useAction();
  const qtyId = useId();
  const [copied, setCopied] = useState(false);
  const options = Math.max(line.maxQty, line.qty, 1);

  const share = async () => {
    const url = `${window.location.origin}/p/${line.slug}?sku=${line.skuId}`;
    try {
      if (navigator.share) await navigator.share({ title: line.title, url });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Share sheet dismissed.
    }
  };

  return (
    <li className="flex gap-4 border-b border-slate-200 py-4 last:border-0" data-testid="cart-line">
      <Thumb image={line.image} slug={line.slug} />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <h3 className="text-base font-medium leading-snug">
            {line.slug ? (
              <Link href={`/p/${line.slug}`} className="hover:underline">
                {line.title}
              </Link>
            ) : (
              line.title
            )}
          </h3>
          {line.unitPrice > 0 && <Price price={line.unitPrice} mrp={line.mrp} size="sm" />}
        </div>
        {Object.keys(line.variant).length > 0 && (
          <p className="text-slate-600">{variantText(line.variant)}</p>
        )}
        <p className={line.inStock ? 'text-green-800' : 'font-medium text-deal'}>
          {!line.inStock
            ? line.stockChange === 'UNAVAILABLE'
              ? 'Unavailable'
              : 'Out of stock'
            : line.available <= 5
              ? `Only ${line.available} left in stock`
              : 'In stock'}
        </p>
        {line.deliveryDate ? (
          <p className="text-slate-700">Delivery by {formatDeliveryDate(line.deliveryDate)}</p>
        ) : (
          !line.serviceable && <p className="text-deal">Not deliverable to this pincode</p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <label htmlFor={qtyId} className="flex items-center gap-1">
            Qty:
            <select
              id={qtyId}
              value={line.qty}
              onChange={(e) => void run(setQty(line, Number(e.target.value)))}
              className="h-8 rounded-md border border-slate-300 bg-slate-50 px-2"
              data-testid="line-qty"
            >
              {Array.from({ length: options }, (_, i) => (
                <option key={i + 1} value={i + 1} disabled={i + 1 > line.maxQty && i + 1 > line.qty}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <span aria-hidden="true" className="text-slate-300">|</span>
          <button type="button" className="text-brand-dark hover:underline" onClick={() => void run(remove(line))}>
            Delete
          </button>
          <span aria-hidden="true" className="text-slate-300">|</span>
          <button
            type="button"
            className="text-brand-dark hover:underline"
            onClick={() => void run(saveForLater(line.id))}
          >
            Save for later
          </button>
          {line.slug && (
            <>
              <span aria-hidden="true" className="text-slate-300">|</span>
              <button type="button" className="text-brand-dark hover:underline" onClick={() => void share()}>
                {copied ? 'Link copied' : 'Share'}
              </button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs font-medium text-deal">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

function SavedRow({ item }: { item: SavedItem }) {
  const { moveToCart, removeSaved } = useCart();
  const { error, run } = useAction();
  return (
    <li className="flex gap-4 border-b border-slate-200 py-4 last:border-0" data-testid="saved-item">
      <Thumb image={item.image} slug={item.slug} />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <h3 className="font-medium">{item.title}</h3>
        {item.price !== null && <Price price={item.price} mrp={item.mrp ?? undefined} size="sm" />}
        {!item.inStock && <p className="text-deal">Currently unavailable</p>}
        <div className="flex gap-3 pt-1">
          {item.inStock && (
            <Button size="sm" variant="secondary" onClick={() => void run(moveToCart(item.id))}>
              Move to cart
            </Button>
          )}
          <button type="button" className="text-brand-dark hover:underline" onClick={() => void run(removeSaved(item.id))}>
            Delete
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs font-medium text-deal">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

function Summary({ cart }: { cart: CartResponse }) {
  const s = cart.summary;
  const progress = s.freeDeliveryThreshold > 0 ? (s.subtotal / s.freeDeliveryThreshold) * 100 : 100;
  return (
    <aside aria-label="Order summary" className="space-y-3 bg-white p-4 lg:sticky lg:top-32" data-testid="cart-summary">
      {s.freeDeliveryEligible ? (
        <p className="text-sm text-green-800">✓ Your order is eligible for FREE delivery.</p>
      ) : (
        <div className="space-y-1">
          <ProgressBar value={progress} label="Progress to free delivery" />
          <p className="text-sm text-slate-700" data-testid="free-delivery-note">
            Add <b>{formatPrice(s.freeDeliveryRemaining)}</b> more for FREE delivery
          </p>
        </div>
      )}
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt>
          Subtotal ({s.itemCount} {s.itemCount === 1 ? 'item' : 'items'})
        </dt>
        <dd className="font-semibold" data-testid="cart-subtotal">
          {formatPrice(s.subtotal)}
        </dd>
        {s.savings > 0 && (
          <>
            <dt className="text-green-800">You save</dt>
            <dd className="text-green-800">{formatPrice(s.savings)}</dd>
          </>
        )}
        <dt>Delivery</dt>
        <dd>{s.deliveryFee === 0 ? 'FREE' : formatPrice(s.deliveryFee)}</dd>
        <dt className="border-t border-slate-200 pt-1 font-bold">Total</dt>
        <dd className="border-t border-slate-200 pt-1 font-bold" data-testid="cart-total">
          {formatPrice(s.total)}
        </dd>
      </dl>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" /> This order contains a gift
      </label>
      {s.itemCount > 0 ? (
        <Link
          href="/checkout"
          className="block rounded-full bg-cta py-2 text-center text-sm font-medium text-slate-900 hover:brightness-95"
          data-testid="proceed-to-buy"
        >
          Proceed to Buy
        </Link>
      ) : (
        <Button block disabled>
          Proceed to Buy
        </Button>
      )}
      {s.hasIssues && (
        <p className="text-xs text-amber-800">Some items need attention; only available items are counted.</p>
      )}
    </aside>
  );
}

/** Cart page (M3.9): lines grouped by seller + delivery date, summary, save for later. */
export function CartView() {
  const { cart, isLoading, isError } = useCart();
  const viewed = useRef(false);

  useEffect(() => {
    if (cart && !viewed.current) {
      viewed.current = true;
      track('view_cart', { items: cart.summary.itemCount, value: cart.summary.subtotal, currency: 'INR' });
    }
  }, [cart]);

  if (isLoading) {
    return (
      <div className="space-y-3 bg-white p-6" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }
  if (isError || !cart) {
    return <p className="bg-white p-6 text-deal">We couldn&apos;t load your cart. Please refresh.</p>;
  }

  const lines = cart.groups.flatMap((g) => g.lines);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] lg:items-start">
      <div className="space-y-4">
        <section className="bg-white p-4 sm:p-6" aria-labelledby="cart-title">
          {lines.length === 0 ? (
            <>
              <h1 id="cart-title" className="mb-2 text-2xl font-bold">
                Your ShopSphere Cart is empty
              </h1>
              <Link href="/" className="text-brand-dark hover:underline">
                Continue shopping
              </Link>
            </>
          ) : (
            <>
              <h1 id="cart-title" className="mb-3 text-2xl font-bold">
                Shopping Cart
              </h1>
              <Banners lines={lines} />
              {cart.groups.map((g) => (
                <section key={g.key} aria-label={`Sold by ${g.sellerName}`} className="mb-2" data-testid="cart-group">
                  <h2 className="border-b border-slate-200 pb-2 text-sm text-slate-700">
                    Sold by <b>{g.fulfilment === 'SHOPSPHERE' ? `${g.sellerName} · Fulfilled by ShopSphere` : g.sellerName}</b>
                    {g.deliveryDate && <> · Delivery by {formatDeliveryDate(g.deliveryDate)}</>}
                  </h2>
                  <ul>
                    {g.lines.map((l) => (
                      <LineRow key={l.id} line={l} />
                    ))}
                  </ul>
                </section>
              ))}
              <p className="text-right text-lg">
                Subtotal ({cart.summary.itemCount} {cart.summary.itemCount === 1 ? 'item' : 'items'}):{' '}
                <b>{formatPrice(cart.summary.subtotal)}</b>
              </p>
            </>
          )}
        </section>
        {cart.saved.length > 0 && (
          <section className="bg-white p-4 sm:p-6" aria-labelledby="saved-title">
            <h2 id="saved-title" className="mb-2 text-xl font-bold">
              Saved for later ({cart.saved.length})
            </h2>
            <ul>
              {cart.saved.map((s) => (
                <SavedRow key={s.id} item={s} />
              ))}
            </ul>
          </section>
        )}
      </div>
      {lines.length > 0 && <Summary cart={cart} />}
    </div>
  );
}
