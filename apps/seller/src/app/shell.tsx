'use client';

import { cx } from '@shopsphere/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSeller } from '@/lib/seller-context';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/listings/new', label: 'Add a listing' },
  { href: '/listings/bulk', label: 'Bulk upload' },
  { href: '/inventory', label: 'Inventory & prices' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { account, signedIn, signOut } = useSeller();
  const pathname = usePathname();
  const approved = account?.status === 'APPROVED';
  return (
    <>
      <header className="bg-brand-navy text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/" className="text-lg font-semibold">
            ShopSphere <span className="font-normal text-slate-300">Seller Central</span>
          </Link>
          {approved && (
            <nav aria-label="Seller" className="flex flex-wrap gap-1">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={pathname === n.href ? 'page' : undefined}
                  className={cx(
                    'rounded px-3 py-1.5 text-sm hover:bg-white/10',
                    pathname === n.href && 'bg-white/15 font-medium',
                  )}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            {account && <span data-testid="seller-name">{account.displayName}</span>}
            {signedIn && (
              <button type="button" onClick={signOut} className="underline">
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {account === undefined ? <p className="text-slate-600">Loading…</p> : children}
      </main>
    </>
  );
}
