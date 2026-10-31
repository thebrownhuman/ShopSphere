import { cx } from '@shopsphere/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SearchQuery, SearchResult } from '@/lib/api/catalog.types';
import { serializeSearchQuery } from '@/lib/search-params';
import { ProductTile } from '../product-tile';
import { FilterPanel, FilterSheet } from './filter-panel';
import { SortSelect } from './sort-select';

function Pagination({
  basePath,
  query,
  result,
  omitCategory,
}: {
  basePath: string;
  query: SearchQuery;
  result: SearchResult;
  omitCategory: boolean;
}) {
  const pages = Math.ceil(result.total / result.pageSize);
  if (pages <= 1) return null;
  const href = (page: number) => {
    const qs = serializeSearchQuery({ ...query, page }, omitCategory);
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === pages || Math.abs(n - result.page) <= 2,
  );
  const cls = 'flex h-9 min-w-9 items-center justify-center rounded border px-3 text-sm';
  return (
    <nav aria-label="Pagination" className="mt-6 flex flex-wrap items-center justify-center gap-1">
      {result.page > 1 && (
        <Link
          href={href(result.page - 1)}
          rel="prev"
          className={cx(cls, 'border-slate-300 bg-white')}
        >
          ‹ Previous
        </Link>
      )}
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && n - nums[i - 1]! > 1 && <span aria-hidden="true">…</span>}
          <Link
            href={href(n)}
            aria-current={n === result.page ? 'page' : undefined}
            className={cx(
              cls,
              n === result.page
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white',
            )}
          >
            {n}
          </Link>
        </span>
      ))}
      {result.page < pages && (
        <Link
          href={href(result.page + 1)}
          rel="next"
          className={cx(cls, 'border-slate-300 bg-white')}
        >
          Next ›
        </Link>
      )}
    </nav>
  );
}

/** Search and category listing (PRD §5): rail/bottom sheet filters, sort, 48-per-page grid. */
export function Listing({
  basePath,
  heading,
  query,
  result,
  omitCategory = false,
  banner,
}: {
  basePath: string;
  heading: string;
  query: SearchQuery;
  result: SearchResult;
  omitCategory?: boolean;
  banner?: ReactNode;
}) {
  const first = (result.page - 1) * result.pageSize + 1;
  const last = Math.min(result.total, result.page * result.pageSize);
  return (
    <main className="mx-auto max-w-page px-3 py-3 md:px-4">
      {banner}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-2 shadow-sm">
        <p className="text-sm" aria-live="polite" data-testid="result-count">
          {result.total ? `${first}-${last} of ${result.total} results` : 'No results'}
          {query.q && (
            <>
              {' '}
              for{' '}
              <span className="font-bold text-accent-darker">
                &ldquo;{result.didYouMean ?? query.q}&rdquo;
              </span>
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <FilterSheet facets={result.facets} query={query} omitCategory={omitCategory} />
          <SortSelect query={query} omitCategory={omitCategory} />
        </div>
      </div>
      {result.didYouMean && (
        <p className="mb-3 bg-white px-4 py-2 text-sm">
          Showing results for <b>{result.didYouMean}</b>. No results found for &ldquo;{query.q}
          &rdquo;.
        </p>
      )}
      <div className="flex gap-4">
        <aside aria-label="Filters" className="hidden w-60 shrink-0 bg-white p-4 lg:block">
          <FilterPanel facets={result.facets} query={query} omitCategory={omitCategory} />
        </aside>
        <section className="min-w-0 flex-1" aria-labelledby="results-heading">
          <h1 id="results-heading" className="mb-2 text-xl font-bold">
            {heading}
          </h1>
          <h2 className="sr-only">Products</h2>
          {result.items.length ? (
            <ul
              className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              data-testid="results-grid"
            >
              {result.items.map((p, i) => (
                <li key={p.id} className="bg-white p-3">
                  <ProductTile product={p} priority={i < 4} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="bg-white p-8" data-testid="no-results">
              <h2 className="mb-2 text-lg font-bold">
                No results{query.q ? ` for “${query.q}”` : ''}
              </h2>
              <ul className="mb-4 list-disc pl-5 text-sm text-slate-700">
                <li>Check the spelling or try more general words</li>
                <li>Remove some filters</li>
              </ul>
              {result.relatedCategories.length > 0 && (
                <>
                  <h3 className="mb-2 font-semibold">Browse related categories</h3>
                  <ul className="flex flex-wrap gap-2">
                    {result.relatedCategories.map((c) => (
                      <li key={c.slug}>
                        <Link
                          href={`/c/${c.slug}`}
                          className="block rounded-full border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
                        >
                          {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <Pagination
            basePath={basePath}
            query={query}
            result={result}
            omitCategory={omitCategory}
          />
        </section>
      </div>
    </main>
  );
}
