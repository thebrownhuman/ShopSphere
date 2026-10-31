'use client';

import { Skeleton } from '@shopsphere/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { helpArticle } from '@/lib/api/returns';

export default function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['help-article', slug],
    queryFn: () => helpArticle(slug),
  });
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <Link href="/help" className="text-brand-dark hover:underline">
          Help centre
        </Link>
        {data && ` › ${data.topic}`}
      </nav>
      {isLoading && <Skeleton className="h-40 w-full" />}
      {isError && <p role="alert">Article not found.</p>}
      {data && (
        <article className="rounded bg-white p-6">
          <h1 className="mb-3 text-2xl font-bold">{data.title}</h1>
          {data.body.map((p) => (
            <p key={p} className="mb-3">
              {p}
            </p>
          ))}
          <p className="mt-6 text-sm text-slate-700">
            Still need help?{' '}
            <Link href="/help/contact" className="text-brand-dark underline">
              Contact support
            </Link>
          </p>
        </article>
      )}
    </main>
  );
}
