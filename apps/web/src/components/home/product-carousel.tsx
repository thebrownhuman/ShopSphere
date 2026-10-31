'use client';

import { SectionCard } from '@shopsphere/ui';
import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
import type { ProductSummary } from '@/lib/api/catalog.types';
import { ProductTile } from '../product-tile';

/** Horizontal, keyboard-scrollable product row with prev/next buttons (PRD §4 recommendation rows). */
export function ProductCarousel({
  title,
  href,
  items,
  extra,
  renderBelow,
}: {
  title: string;
  href?: string;
  items: ProductSummary[];
  extra?: ReactNode;
  renderBelow?: (p: ProductSummary) => ReactNode;
}) {
  const scroller = useRef<HTMLUListElement>(null);
  const id = `row-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const scroll = (dir: 1 | -1) =>
    scroller.current?.scrollBy({
      left: dir * scroller.current.clientWidth * 0.9,
      behavior: 'smooth',
    });
  if (!items.length) return null;
  return (
    <SectionCard
      headingId={id}
      title={
        <span className="flex flex-wrap items-baseline gap-x-4">
          {title}
          {extra}
        </span>
      }
      action={
        href && (
          <Link
            href={href}
            className="shrink-0 text-sm font-normal text-brand-dark hover:underline"
          >
            See all<span className="sr-only"> {title}</span>
          </Link>
        )
      }
    >
      <div className="relative">
        <ul
          ref={scroller}
          tabIndex={0}
          aria-labelledby={id}
          className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-2 outline-none focus-visible:ring-2 focus-visible:ring-brand [scrollbar-width:thin]"
        >
          {items.map((p) => (
            <li key={p.id} className="w-40 shrink-0 snap-start sm:w-48">
              <ProductTile product={p} compact sizes="192px" />
              {renderBelow?.(p)}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => scroll(-1)}
          aria-label={`Scroll ${title} left`}
          className="absolute left-0 top-16 hidden h-20 w-10 items-center justify-center rounded-r bg-white/95 text-2xl shadow md:flex"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => scroll(1)}
          aria-label={`Scroll ${title} right`}
          className="absolute right-0 top-16 hidden h-20 w-10 items-center justify-center rounded-l bg-white/95 text-2xl shadow md:flex"
        >
          ›
        </button>
      </div>
    </SectionCard>
  );
}
