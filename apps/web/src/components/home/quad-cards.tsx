'use client';

import Link from 'next/link';
import type { QuadCard } from '@/lib/api/catalog.types';
import { CatalogImage } from '../catalog-image';
import { useGreetingName } from '../header/account-link';

/** PRD §4 quad cards: 4 cards of 4 tiles, personalised by audience (guest vs signed in). */
export function QuadCards({ cards }: { cards: QuadCard[] }) {
  const signedIn = useGreetingName() !== null;
  const visible = cards
    .filter((c) => c.audience === 'all' || (c.audience === 'guest' ? !signedIn : signedIn))
    .slice(0, 4);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {visible.map((card) => (
        <section
          key={card.id}
          aria-labelledby={`quad-${card.id}`}
          className="flex flex-col bg-white p-4"
        >
          <h2 id={`quad-${card.id}`} className="mb-3 text-lg font-bold leading-tight">
            {card.title}
          </h2>
          {card.tiles.length ? (
            <ul className="grid flex-1 grid-cols-2 gap-3">
              {card.tiles.slice(0, 4).map((t) => (
                <li key={t.href + t.label}>
                  <Link href={t.href} className="group block text-xs">
                    {t.image ? (
                      <CatalogImage
                        image={{ ...t.image, alt: '' }}
                        sizes="(min-width:1024px) 10vw, 40vw"
                        className="aspect-square w-full bg-slate-100 object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="block aspect-square w-full bg-slate-100"
                      />
                    )}
                    <span className="mt-1 block truncate group-hover:underline">{t.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : card.cta ? (
            <div className="flex flex-1 flex-col justify-center gap-3">
              <p className="text-sm text-slate-700">
                See personalised recommendations, track orders and reorder in a click.
              </p>
              <Link
                href={card.cta.href}
                className="flex h-10 items-center justify-center rounded-full bg-cta text-sm font-medium text-slate-900 hover:bg-cta-dark"
              >
                {card.cta.label}
              </Link>
            </div>
          ) : null}
          {card.tiles.length > 0 && card.cta && (
            <Link href={card.cta.href} className="mt-3 text-sm text-brand-dark hover:underline">
              {card.cta.label}
              <span className="sr-only">: {card.title}</span>
            </Link>
          )}
        </section>
      ))}
    </div>
  );
}
