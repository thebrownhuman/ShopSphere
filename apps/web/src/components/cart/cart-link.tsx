'use client';

import Link from 'next/link';
import { useCartMaybe } from '@/lib/cart';

/** Header cart icon; the count pops whenever something is added (M3.7). */
export function CartLink() {
  const cart = useCartMaybe();
  const count = Math.max(0, cart?.count ?? 0);
  return (
    <Link
      href="/cart"
      aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}
      className="relative flex items-end rounded px-2 py-1 font-semibold hover:outline hover:outline-1 hover:outline-white"
      data-testid="cart-link"
    >
      <svg
        aria-hidden="true"
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6" />
        <circle cx="9" cy="20" r="1.4" />
        <circle cx="17" cy="20" r="1.4" />
      </svg>
      <span
        // Re-mounting on each add restarts the pop animation.
        key={cart?.bump ?? 0}
        aria-hidden="true"
        data-testid="cart-count"
        className="absolute left-[18px] top-0 animate-cart-pop text-sm font-bold text-cta motion-reduce:animate-none"
      >
        {count > 99 ? '99+' : count}
      </span>
      <span className="hidden text-sm sm:inline">Cart</span>
    </Link>
  );
}
