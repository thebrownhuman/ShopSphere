'use client';

import Link from 'next/link';
import { useRef } from 'react';
import type { CategoryNode } from '@/lib/api/catalog.types';
import { useGreetingName } from './account-link';

/** "All" hamburger: full category tree in a side drawer (native <dialog>, keyboard-safe). */
export function MegaMenu({ categories }: { categories: CategoryNode[] }) {
  const greeting = useGreetingName() ?? 'sign in';
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="flex shrink-0 items-center gap-1 rounded px-2 py-1 font-semibold hover:outline hover:outline-1 hover:outline-white"
        aria-haspopup="dialog"
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.4"
        >
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
        All
      </button>
      <dialog
        ref={ref}
        aria-label="All categories"
        onClick={(e) => e.target === ref.current && close()}
        className="m-0 h-full max-h-none w-[min(86vw,22rem)] max-w-none bg-white p-0 text-slate-900 backdrop:bg-black/60"
      >
        <div className="flex items-center justify-between bg-brand-navy px-5 py-4 text-white">
          <p className="text-lg font-bold">Hello, {greeting}</p>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="rounded p-1 text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <nav aria-label="Shop by category" className="pb-8">
          <h2 className="px-5 pb-1 pt-4 text-lg font-bold">Shop by category</h2>
          {categories.map((c) => (
            <div key={c.id} className="border-b border-slate-200 py-2">
              <Link
                href={`/c/${c.slug}`}
                onClick={close}
                className="block px-5 py-2 font-semibold hover:bg-slate-100"
              >
                {c.name}
              </Link>
              <ul>
                {c.children?.map((leaf) => (
                  <li key={leaf.id}>
                    <Link
                      href={`/c/${leaf.slug}`}
                      onClick={close}
                      className="block px-8 py-1.5 text-sm text-slate-800 hover:bg-slate-100"
                    >
                      {leaf.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </dialog>
    </>
  );
}
