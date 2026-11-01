'use client';

import type { StaffRole } from '@shopsphere/types';
import { cx } from '@shopsphere/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAdmin } from '@/lib/admin-context';

/** Nav entries; `roles` mirror the API guards so staff only see what they can use. */
const NAV: { href: string; label: string; roles: StaffRole[] }[] = [
  { href: '/users', label: 'Users', roles: ['SUPPORT'] },
  { href: '/sellers', label: 'Sellers', roles: ['CATALOG', 'SUPPORT'] },
  { href: '/catalog', label: 'Catalog', roles: ['CATALOG'] },
  { href: '/orders', label: 'Orders', roles: ['SUPPORT', 'FINANCE'] },
  { href: '/promotions', label: 'Promotions', roles: ['CATALOG', 'FINANCE'] },
  { href: '/home-cms', label: 'Home page', roles: ['CATALOG'] },
  // Review moderation lands with the reviews milestone (/admin/reviews API on its branch).
  { href: '/reviews', label: 'Reviews', roles: ['CATALOG', 'SUPPORT'] },
  { href: '/audit', label: 'Audit log', roles: ['FINANCE'] },
];

export function Shell({ children }: { children: ReactNode }) {
  const { me, signOut, can } = useAdmin();
  const pathname = usePathname();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900"
      >
        Skip to main content
      </a>
      <header className="bg-brand-navy text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/" className="text-lg font-semibold">
            ShopSphere <span className="font-normal text-slate-300">Admin</span>
          </Link>
          {me && (
            <nav aria-label="Admin" className="flex flex-wrap gap-1">
              {NAV.filter((n) => can(...n.roles)).map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={pathname.startsWith(n.href) ? 'page' : undefined}
                  className={cx(
                    'rounded px-3 py-1.5 text-sm hover:bg-white/10',
                    pathname.startsWith(n.href) && 'bg-white/15 font-medium',
                  )}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
          {me && (
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span data-testid="admin-name">
                {me.name ?? me.email} · {me.roles.join(', ')}
              </span>
              <button type="button" onClick={signOut} className="underline">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 outline-none">
        {me === undefined && pathname !== '/signin' ? (
          <p className="text-slate-600">Loading…</p>
        ) : me || pathname === '/signin' ? (
          children
        ) : null}
      </main>
    </>
  );
}
