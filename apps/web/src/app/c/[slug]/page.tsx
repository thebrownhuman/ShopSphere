import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CatalogImage } from '@/components/catalog-image';
import { Listing } from '@/components/search/listing';
import { getCategories, search } from '@/lib/api/catalog';
import type { CategoryNode } from '@/lib/api/catalog.types';
import { parseSearchQuery } from '@/lib/search-params';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function findCategory(
  slug: string,
): Promise<{ node: CategoryNode; parent?: CategoryNode } | null> {
  for (const c of await getCategories()) {
    if (c.slug === slug) return { node: c };
    const leaf = c.children?.find((l) => l.slug === slug);
    if (leaf) return { node: leaf, parent: c };
  }
  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await findCategory((await params).slug);
  if (!found) return {};
  const { node } = found;
  return {
    title: `${node.name}: Shop ${node.name} online`,
    description: `Buy ${node.name} online at ShopSphere. Best prices, fast delivery and easy returns.`,
    alternates: { canonical: `/c/${node.slug}` },
    openGraph: { title: node.name, url: `/c/${node.slug}` },
  };
}

/** Category page: same engine as search, plus curated banner and sub-category tiles (PRD §5). */
export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const found = await findCategory(slug);
  if (!found) notFound();
  const query = parseSearchQuery(await searchParams, { category: slug });
  query.category = slug;
  const result = await search(query);
  const { node, parent } = found;
  const banner = (
    <div className="mb-3 bg-white p-4">
      <nav aria-label="Breadcrumb" className="mb-2 text-xs text-slate-700">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        {parent && (
          <>
            {' › '}
            <Link href={`/c/${parent.slug}`} className="hover:underline">
              {parent.name}
            </Link>
          </>
        )}
        {' › '}
        <span aria-current="page">{node.name}</span>
      </nav>
      {node.children?.length ? (
        <ul className="flex gap-4 overflow-x-auto pb-1">
          {node.children.map((c) => (
            <li key={c.id} className="w-24 shrink-0 text-center text-xs">
              <Link href={`/c/${c.slug}`} className="group block">
                {c.image && (
                  <CatalogImage
                    image={c.image}
                    sizes="96px"
                    className="mx-auto aspect-square w-20 rounded-full object-cover"
                  />
                )}
                <span className="mt-1 block group-hover:underline">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
  return (
    <Listing
      basePath={`/c/${slug}`}
      heading={node.name}
      query={query}
      result={result}
      omitCategory
      banner={banner}
    />
  );
}
