'use client';

import type { SearchQuery, SortKey } from '@/lib/api/catalog.types';
import { SORTS } from '@/lib/search-params';
import { useApplyQuery } from './filter-panel';

export function SortSelect({
  query: urlQuery,
  omitCategory = false,
}: {
  query: SearchQuery;
  omitCategory?: boolean;
}) {
  const { query, apply } = useApplyQuery(urlQuery, omitCategory);
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="whitespace-nowrap">Sort by:</span>
      <select
        value={query.sort}
        onChange={(e) => apply({ ...query, sort: e.target.value as SortKey, page: 1 })}
        className="h-8 rounded-md border border-slate-300 bg-slate-50 px-2 text-sm"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
