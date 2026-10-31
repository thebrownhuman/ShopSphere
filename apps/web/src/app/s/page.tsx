import type { Metadata } from 'next';
import { Listing } from '@/components/search/listing';
import { search } from '@/lib/api/catalog';
import { parseSearchQuery, serializeSearchQuery } from '@/lib/search-params';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseSearchQuery(await searchParams);
  const canonical = `/s?${serializeSearchQuery({ ...q, sort: 'featured' })}`;
  return {
    title: q.q ? `${q.q}: Buy ${q.q} online` : 'Search',
    alternates: { canonical },
    // Filtered permutations are crawlable via links but kept out of the index.
    robots:
      q.brand.length || Object.keys(q.attrs).length || q.priceMin || q.priceMax
        ? { index: false, follow: true }
        : undefined,
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const query = parseSearchQuery(await searchParams);
  const result = await search(query);
  return (
    <Listing
      basePath="/s"
      heading={query.q ? 'Results' : 'All products'}
      query={query}
      result={result}
    />
  );
}
