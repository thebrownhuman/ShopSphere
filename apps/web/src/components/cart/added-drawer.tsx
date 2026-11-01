'use client';

import { Price, formatPrice } from '@shopsphere/ui';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useCart } from '@/lib/cart';
import { CatalogImage } from '../catalog-image';
import { AddToCartButton } from './add-to-cart-button';

/** "Added to cart" side drawer (M3.8): confirmation, subtotal, checkout CTA, 3 add-ons. */
export function AddedToCartDrawer() {
  const { drawer, closeDrawer, cart } = useCart();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const open = !!drawer;

  // Modal focus management (M7.4): focus moves in, Tab stays inside, Escape closes and focus
  // returns to whatever opened the drawer (usually the Add to cart button).
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeDrawer();
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, closeDrawer]);

  if (!drawer || !cart) return null;
  const line = cart.groups.flatMap((g) => g.lines).find((l) => l.id === drawer.lineId);
  const s = cart.summary;

  return (
    <div className="fixed inset-0 z-50" data-testid="added-drawer">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-black/40"
        onClick={closeDrawer}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="added-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col overflow-y-auto bg-white shadow-xl"
      >
        <div className="flex items-start gap-3 border-b border-slate-200 p-4">
          {line?.image && (
            <CatalogImage
              image={{ url: line.image.small, alt: line.image.alt, width: 300, height: 300 }}
              className="h-16 w-16 shrink-0 object-contain"
            />
          )}
          <div className="min-w-0 flex-1">
            <h2 id="added-title" className="text-lg font-bold text-green-800">
              ✓ Added to cart
            </h2>
            {line && <p className="line-clamp-2 text-sm text-slate-700">{line.title}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={closeDrawer}
            aria-label="Close added to cart"
            className="rounded p-1 text-xl leading-none text-slate-600 hover:bg-slate-100"
          >
            ×
          </button>
        </div>
        <div className="space-y-3 border-b border-slate-200 p-4">
          <p className="text-sm">
            Cart subtotal ({s.itemCount} {s.itemCount === 1 ? 'item' : 'items'}):{' '}
            <b data-testid="drawer-subtotal">{formatPrice(s.subtotal)}</b>
          </p>
          {s.freeDeliveryEligible ? (
            <p className="text-xs text-green-800">Your order is eligible for FREE delivery.</p>
          ) : (
            <p className="text-xs text-slate-700">
              Add <b>{formatPrice(s.freeDeliveryRemaining)}</b> more for FREE delivery.
            </p>
          )}
          <Link
            href="/checkout"
            onClick={closeDrawer}
            className="block rounded-full bg-cta py-2 text-center text-sm font-medium text-slate-900 hover:brightness-95"
          >
            Proceed to checkout
          </Link>
          <Link
            href="/cart"
            onClick={closeDrawer}
            className="block rounded-full border border-slate-300 py-2 text-center text-sm hover:bg-slate-50"
          >
            Go to Cart
          </Link>
        </div>
        {drawer.addOns.length > 0 && (
          <section aria-labelledby="addons-title" className="p-4">
            <h3 id="addons-title" className="mb-3 font-bold">
              Frequently bought together
            </h3>
            <ul className="space-y-4">
              {drawer.addOns.map((p) => (
                <li key={p.productId} className="flex gap-3" data-testid="addon">
                  {p.image && (
                    <CatalogImage
                      image={{ url: p.image.small, alt: p.image.alt, width: 300, height: 300 }}
                      className="h-16 w-16 shrink-0 object-contain"
                    />
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <Link
                      href={`/p/${p.slug}`}
                      onClick={closeDrawer}
                      className="line-clamp-2 hover:underline"
                    >
                      {p.title}
                    </Link>
                    {p.pricing && <Price price={p.pricing.price} size="sm" />}
                    <AddToCartButton
                      sku={p.skuId}
                      price={p.pricing?.price}
                      size="sm"
                      label="Add"
                      className="mt-1"
                      data-testid="addon-add"
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
