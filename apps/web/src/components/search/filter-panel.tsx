'use client';

import { Button, cx } from '@shopsphere/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from 'react';
import type { Facet, SearchQuery } from '@/lib/api/catalog.types';
import {
  activeFilterCount,
  clearFilters,
  serializeSearchQuery,
  toggleFacet,
} from '@/lib/search-params';

/**
 * Pushes listing state into the URL (no full reload); the server page re-renders results.
 * Controls show the new state optimistically while the transition is in flight.
 */
export function useApplyQuery(query: SearchQuery, omitCategory: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(query);
  const apply = (q: SearchQuery) => {
    const qs = serializeSearchQuery(q, omitCategory);
    startTransition(() => {
      setShown(q);
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };
  return { query: shown, apply, pending };
}

const SINGLE: Record<string, keyof SearchQuery> = {
  rating: 'rating',
  discount: 'discount',
  delivery: 'delivery',
};

function PriceRange({
  facet,
  query,
  onApply,
}: {
  facet: Extract<Facet, { type: 'range' }>;
  query: SearchQuery;
  onApply: (min?: number, max?: number) => void;
}) {
  const id = useId();
  const [min, setMin] = useState(query.priceMin ?? facet.min);
  const [max, setMax] = useState(query.priceMax ?? facet.max);
  useEffect(() => {
    setMin(query.priceMin ?? facet.min);
    setMax(query.priceMax ?? facet.max);
  }, [query.priceMin, query.priceMax, facet.min, facet.max]);
  const step = Math.max(1, Math.round((facet.max - facet.min) / 100));
  return (
    <div className="space-y-2 text-sm">
      <p aria-live="polite">
        ₹{min.toLocaleString('en-IN')} – ₹{max.toLocaleString('en-IN')}
        {max >= facet.max ? '+' : ''}
      </p>
      <label htmlFor={`${id}-min`} className="sr-only">
        Minimum price
      </label>
      <input
        id={`${id}-min`}
        type="range"
        min={facet.min}
        max={facet.max}
        step={step}
        value={min}
        onChange={(e) => setMin(Math.min(Number(e.target.value), max))}
        className="w-full accent-brand-dark"
      />
      <label htmlFor={`${id}-max`} className="sr-only">
        Maximum price
      </label>
      <input
        id={`${id}-max`}
        type="range"
        min={facet.min}
        max={facet.max}
        step={step}
        value={max}
        onChange={(e) => setMax(Math.max(Number(e.target.value), min))}
        className="w-full accent-brand-dark"
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          onApply(min > facet.min ? min : undefined, max < facet.max ? max : undefined)
        }
      >
        Go
      </Button>
    </div>
  );
}

/** Filter rail content, shared by the desktop rail and the mobile bottom sheet (PRD §5). */
export function FilterPanel({
  facets,
  query: urlQuery,
  omitCategory = false,
}: {
  facets: Facet[];
  query: SearchQuery;
  omitCategory?: boolean;
}) {
  const { query, apply, pending } = useApplyQuery(urlQuery, omitCategory);
  const uid = useId();
  const count = activeFilterCount(query);
  return (
    <div
      aria-busy={pending}
      className={cx('space-y-5', pending && 'opacity-70')}
      data-testid="filter-panel"
    >
      {count > 0 && (
        <button
          type="button"
          className="text-sm text-brand-dark underline"
          onClick={() => apply(clearFilters(query))}
        >
          Clear all filters ({count})
        </button>
      )}
      {query.inStock !== undefined || facets.length ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!query.inStock}
            className="h-4 w-4 accent-brand-dark"
            onChange={() => apply({ ...query, inStock: query.inStock ? undefined : true, page: 1 })}
          />
          Exclude out of stock
        </label>
      ) : null}
      {facets.map((f) => (
        <fieldset key={f.key} className="border-t border-slate-200 pt-3">
          <legend className="mb-2 text-sm font-bold">{f.label}</legend>
          {f.type === 'range' ? (
            <PriceRange
              facet={f}
              query={query}
              onApply={(priceMin, priceMax) => apply({ ...query, priceMin, priceMax, page: 1 })}
            />
          ) : f.key === 'category' ? (
            <ul className="space-y-1 text-sm">
              {f.values.map((v) => (
                <li key={v.value}>
                  <button
                    type="button"
                    className="text-left hover:text-accent-darker"
                    onClick={() => apply({ ...query, category: v.value, page: 1 })}
                  >
                    {v.label} <span className="text-slate-600">({v.count})</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : SINGLE[f.key] ? (
            <ul className="space-y-1 text-sm">
              {f.values.map((v) => {
                const k = SINGLE[f.key]!;
                const current = String(query[k] ?? '');
                const selected = current === v.value;
                return (
                  <li key={v.value}>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name={`${uid}-${f.key}`}
                        checked={selected}
                        className="h-4 w-4 accent-brand-dark"
                        onChange={() =>
                          apply({
                            ...query,
                            [k]: k === 'delivery' ? v.value : Number(v.value),
                            page: 1,
                          })
                        }
                        onClick={() => selected && apply({ ...query, [k]: undefined, page: 1 })}
                      />
                      <span>{v.label}</span>
                      <span className="text-slate-600">({v.count})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {f.values.map((v) => {
                const selected = (
                  f.key === 'brand' ? query.brand : (query.attrs[f.key] ?? [])
                ).includes(v.value);
                return (
                  <li key={v.value}>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        className="h-4 w-4 accent-brand-dark"
                        onChange={() => apply(toggleFacet(query, f.key, v.value))}
                      />
                      <span>{v.label}</span>
                      <span className="text-slate-600">({v.count})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
      ))}
    </div>
  );
}

/** Mobile: "Filters" button opening a bottom sheet (native <dialog>). */
export function FilterSheet(props: {
  facets: Facet[];
  query: SearchQuery;
  omitCategory?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const count = activeFilterCount(props.query);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => ref.current?.showModal()}
        className="lg:hidden"
        aria-haspopup="dialog"
      >
        Filters{count ? ` (${count})` : ''}
      </Button>
      <dialog
        ref={ref}
        aria-label="Filters"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="mb-0 mt-auto max-h-[85vh] w-full max-w-none rounded-t-2xl p-0 backdrop:bg-black/50"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="text-lg font-bold">Filters</h2>
          <Button size="sm" onClick={() => ref.current?.close()}>
            Show results
          </Button>
        </div>
        <div className="p-4">
          <FilterPanel {...props} />
        </div>
      </dialog>
    </>
  );
}
