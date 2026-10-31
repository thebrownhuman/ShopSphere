import Link from 'next/link';
import { Suspense } from 'react';
import type { CategoryNode } from '@/lib/api/catalog.types';
import { AccountLink } from './account-link';
import { MegaMenu } from './mega-menu';
import { PincodeButton } from './pincode-button';
import { SearchBox } from './search-box';

const NAV = [
  { label: "Today's Deals", href: '/s?discount=25' },
  { label: 'Mobiles', href: '/c/mobiles' },
  { label: 'Fashion', href: '/c/fashion' },
  { label: 'Electronics', href: '/c/electronics' },
  { label: 'Home', href: '/c/home-kitchen' },
  { label: 'Grocery', href: '/c/grocery' },
  { label: 'Plus', href: '/s?delivery=plus' },
];

/** PRD §4 sticky header + category strip. Account state is client-side (see AccountLink). */
export function SiteHeader({ categories }: { categories: CategoryNode[] }) {
  return (
    <header className="sticky top-0 z-40 text-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-slate-900"
      >
        Skip to main content
      </a>
      <div className="bg-brand-navy">
        <div className="mx-auto flex max-w-page flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 md:flex-nowrap">
          <Link
            href="/"
            className="order-1 shrink-0 rounded px-1 text-xl font-extrabold tracking-tight"
            aria-label="ShopSphere home"
          >
            Shop<span className="text-cta">Sphere</span>
          </Link>
          <div className="order-2 hidden md:block">
            <PincodeButton />
          </div>
          <div className="order-last w-full md:order-3 md:flex-1">
            <Suspense fallback={<div className="h-10 w-full rounded-md bg-white" />}>
              <SearchBox categories={categories.map(({ slug, name }) => ({ slug, name }))} />
            </Suspense>
          </div>
          <div className="order-3 ml-auto flex shrink-0 items-center gap-1 md:order-4 md:ml-0">
            <span className="hidden px-2 text-sm font-semibold xl:block" title="Language">
              EN
            </span>
            <AccountLink />
            <Link
              href="/account"
              className="hidden rounded px-2 py-1 text-sm hover:outline hover:outline-1 hover:outline-white lg:block"
            >
              <span className="block text-xs opacity-90">Returns</span>
              <span className="font-semibold">&amp; Orders</span>
            </Link>
            <Link
              href="/cart"
              aria-label="Cart, 0 items"
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
                aria-hidden="true"
                className="absolute left-[18px] top-0 text-sm font-bold text-cta"
              >
                0
              </span>
              <span className="hidden text-sm sm:inline">Cart</span>
            </Link>
          </div>
        </div>
      </div>
      <nav aria-label="Categories" className="bg-brand-darker">
        <ul className="mx-auto flex max-w-page items-center gap-1 overflow-x-auto whitespace-nowrap px-3 py-1 text-sm [scrollbar-width:none]">
          <li>
            <MegaMenu categories={categories} />
          </li>
          {NAV.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                className="block rounded px-2 py-1 hover:outline hover:outline-1 hover:outline-white"
              >
                {n.label}
              </Link>
            </li>
          ))}
          <li className="md:hidden">
            <PincodeButton />
          </li>
        </ul>
      </nav>
    </header>
  );
}
