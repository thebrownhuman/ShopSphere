'use client';

import type { HelpArticle } from '@shopsphere/types';
import { Skeleton } from '@shopsphere/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { helpArticles } from '@/lib/api/returns';

/** Help centre (M6.8): static articles grouped by topic, searchable, plus the contact form. */
export default function HelpPage() {
  const [q, setQ] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['help', q],
    queryFn: () => helpArticles(q || undefined),
  });
  const topics = new Map<string, HelpArticle[]>();
  for (const a of data?.items ?? []) topics.set(a.topic, [...(topics.get(a.topic) ?? []), a]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">Help centre</h1>
      <p className="mb-4 text-slate-700">
        Find answers about orders, returns and payments, or{' '}
        <Link href="/help/contact" className="text-brand-dark underline">
          contact support
        </Link>
        .
      </p>
      <input
        type="search"
        aria-label="Search help"
        placeholder="Search help, e.g. refund"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-6 w-full rounded border border-slate-300 px-3 py-2"
      />
      {isLoading && <Skeleton className="h-40 w-full" />}
      {isError && <p role="alert">Could not load help articles.</p>}
      {data && data.items.length === 0 && <p>No articles match “{q}”.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {[...topics].map(([topic, items]) => (
          <section key={topic} className="rounded bg-white p-4">
            <h2 className="mb-2 font-bold">{topic}</h2>
            <ul className="space-y-2 text-sm">
              {items.map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`} className="text-brand-dark hover:underline">
                    {a.title}
                  </Link>
                  <p className="text-slate-600">{a.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
