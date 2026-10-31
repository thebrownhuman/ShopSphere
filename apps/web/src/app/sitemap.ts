import type { MetadataRoute } from 'next';
import { getCategories, listProductSlugs } from '@/lib/api/catalog';
import { SITE_URL } from '@/lib/site';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Builds run without the API (CI); an empty sitemap regenerates on the next revalidate.
  const [categories, products] = await Promise.all([
    getCategories().catch(() => []),
    listProductSlugs().catch(() => []),
  ]);
  const cats = categories.flatMap((c) => [c, ...(c.children ?? [])]);
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    ...cats.map((c) => ({
      url: `${SITE_URL}/c/${c.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...products.map((p) => ({
      url: `${SITE_URL}/p/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
  ];
}
