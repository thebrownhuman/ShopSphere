'use client';

import { cx } from '@shopsphere/ui';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { suggest } from '@/lib/api/catalog';
import type { Suggestion } from '@/lib/api/catalog.types';

const RECENT_KEY = 'ss_recent_searches';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * Category select + search box with ARIA combobox autocomplete (PRD §5: suggestions after
 * 2 characters, debounced 150 ms; queries, categories and recent searches).
 */
export function SearchBox({ categories }: { categories: Array<{ slug: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(pathname === '/s' ? (params.get('k') ?? '') : '');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pathname === '/s') setText(params.get('k') ?? '');
  }, [pathname, params]);

  const term = useDebounced(text.trim(), 150);
  const { data: remote = [] } = useQuery({
    queryKey: ['suggest', term],
    queryFn: ({ signal }) => suggest(term, { signal }),
    enabled: term.length >= 2,
    staleTime: 60_000,
  });
  const items: Suggestion[] =
    text.trim().length >= 2
      ? remote
      : recent
          .slice(0, 5)
          .map((q) => ({ kind: 'query', label: q, href: `/s?k=${encodeURIComponent(q)}` }));
  const showList = open && items.length > 0;

  function go(href: string, query?: string) {
    if (query) {
      const next = [query, ...readRecent().filter((r) => r !== query)].slice(0, 8);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* best-effort */
      }
    }
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
    router.push(href);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const choice = active >= 0 ? items[active] : undefined;
    if (choice) return go(choice.href, choice.kind === 'query' ? choice.label : undefined);
    const q = text.trim();
    if (!q && !category) return;
    const qs = new URLSearchParams();
    if (q) qs.set('k', q);
    if (category) qs.set('category', category);
    go(`/s?${qs}`, q || undefined);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % Math.max(items.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="relative flex h-10 w-full min-w-0 rounded-md bg-white text-slate-900 focus-within:ring-2 focus-within:ring-cta"
    >
      <label htmlFor="search-category" className="sr-only">
        Search in category
      </label>
      <select
        id="search-category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="hidden max-w-[9rem] shrink-0 cursor-pointer rounded-l-md border-r border-slate-300 bg-slate-100 px-2 text-xs text-slate-800 md:block"
      >
        <option value="">All</option>
        {categories.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        ref={inputRef}
        type="search"
        name="k"
        value={text}
        placeholder="Search for products, brands and more"
        aria-label="Search ShopSphere"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          setRecent(readRecent());
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 rounded-l-md bg-transparent px-3 text-sm outline-none placeholder:text-slate-500 md:rounded-none"
      />
      <button
        type="submit"
        aria-label="Search"
        className="flex w-12 shrink-0 items-center justify-center rounded-r-md bg-cta text-slate-900 hover:bg-cta-dark"
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-label="Search suggestions"
        hidden={!showList}
        className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
      >
        {items.map((s, i) => (
          <li
            key={`${s.kind}:${s.href}`}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              go(s.href, s.kind === 'query' ? s.label : undefined);
            }}
            onMouseEnter={() => setActive(i)}
            className={cx(
              'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
              i === active && 'bg-slate-100',
            )}
          >
            <span aria-hidden="true" className="w-4 text-slate-500">
              {s.kind === 'product' ? '▢' : s.kind === 'category' ? '☰' : '⌕'}
            </span>
            <span className="truncate">
              {s.label}
              {s.kind === 'category' && <span className="text-slate-600"> in categories</span>}
            </span>
          </li>
        ))}
      </ul>
    </form>
  );
}
