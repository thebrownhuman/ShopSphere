import { SectionCard } from '@shopsphere/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CatalogImage } from '@/components/catalog-image';
import { DealRow } from '@/components/home/deal-row';
import { HeroCarousel } from '@/components/home/hero-carousel';
import { LazySection } from '@/components/home/lazy-section';
import { ProductCarousel } from '@/components/home/product-carousel';
import { QuadCards } from '@/components/home/quad-cards';
import { RecentlyViewed } from '@/components/recently-viewed';
import { getHome } from '@/lib/api/catalog';
import type { HomeSection } from '@/lib/api/catalog.types';

// ISR: CMS-driven rows change rarely; live price/stock lives on the PDP buy box.
export const revalidate = 300;

export const metadata: Metadata = { alternates: { canonical: '/' } };

function Section({ section, index }: { section: HomeSection; index: number }) {
  switch (section.type) {
    case 'hero':
      return <HeroCarousel banners={section.banners} />;
    case 'quad':
      return <QuadCards cards={section.cards} />;
    case 'deals':
      return (
        <DealRow
          title={section.title}
          endsAt={section.endsAt}
          href={section.href}
          items={section.items}
        />
      );
    case 'carousel': {
      const row = (
        <ProductCarousel title={section.title} href={section.href} items={section.items} />
      );
      // Hero, quad cards and deals render on the server; later rows mount on approach.
      return index > 2 ? <LazySection>{row}</LazySection> : row;
    }
    case 'recently-viewed':
      return <RecentlyViewed title={section.title} />;
    case 'category-tiles':
      return (
        <SectionCard title={section.title} headingId={`sec-${section.id}`}>
          <ul className="flex gap-4 overflow-x-auto pb-1">
            {section.categories.map((c) => (
              <li key={c.slug} className="w-24 shrink-0 text-center text-xs">
                <Link href={`/c/${c.slug}`} className="group block">
                  {c.image ? (
                    <CatalogImage
                      image={c.image}
                      sizes="96px"
                      className="mx-auto aspect-square w-20 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mx-auto block aspect-square w-20 rounded-full bg-slate-100"
                    />
                  )}
                  <span className="mt-1 block group-hover:underline">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      );
  }
}

export default async function HomePage() {
  // API down at build/regeneration: render the shell; ISR retries after `revalidate`.
  const { sections } = await getHome().catch(() => ({ sections: [] as HomeSection[] }));
  const hero = sections.find((s) => s.type === 'hero');
  const rest = sections.filter((s) => s.type !== 'hero');
  return (
    <main className="mx-auto max-w-page pb-6">
      <h1 className="sr-only">ShopSphere: online shopping</h1>
      {hero && <Section section={hero} index={0} />}
      {/* Cards overlap the hero's lower edge, as on large marketplaces. */}
      <div className="relative z-10 -mt-4 space-y-5 px-3 md:-mt-24 md:px-4">
        {rest.map((s, i) => (
          <Section key={s.id} section={s} index={i + 1} />
        ))}
      </div>
    </main>
  );
}
