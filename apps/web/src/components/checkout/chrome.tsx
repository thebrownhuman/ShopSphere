'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** PRD §8: checkout drops the full header (logo + "Secure checkout" only) and the footer. */
export function CheckoutHeader() {
  return (
    <header className="bg-brand-navy text-white">
      <div className="mx-auto flex max-w-page items-center justify-between px-3 py-3">
        <Link
          href="/"
          className="text-xl font-extrabold tracking-tight"
          aria-label="ShopSphere home"
        >
          Shop<span className="text-cta">Sphere</span>
        </Link>
        <span className="text-sm font-semibold">🔒 Secure checkout</span>
      </div>
    </header>
  );
}

const stripped = (path: string | null) => !!path && path.startsWith('/checkout');

/** Renders `children` (the full site chrome) everywhere except checkout, where `checkout` shows. */
export function ChromeGate({ children, checkout }: { children: ReactNode; checkout?: ReactNode }) {
  return stripped(usePathname()) ? (checkout ?? null) : children;
}
