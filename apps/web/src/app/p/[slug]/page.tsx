import { RatingStars, SectionCard, formatCount } from '@shopsphere/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductCarousel } from '@/components/home/product-carousel';
import { BuyBox, MobileBuyBar } from '@/components/pdp/buy-box';
import { PriceBlock, Variants } from '@/components/pdp/details';
import { Gallery } from '@/components/pdp/gallery';
import { LiveEffects } from '@/components/pdp/live-effects';
import { PdpProvider } from '@/components/pdp/pdp-context';
import { QuestionsSection } from '@/components/pdp/questions';
import { ReviewsSection } from '@/components/pdp/reviews';
import { RecentlyViewed } from '@/components/recently-viewed';
import { getProduct } from '@/lib/api/catalog';
import { SITE_URL } from '@/lib/site';

// ISR for descriptive content only. Price, stock and delivery are fetched live on the client.
export const revalidate = 300;
export const dynamicParams = true;
export async function generateStaticParams() {
  return []; // Rendered on first request, then cached.
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  if (!p) return {};
  const image = p.skus[0]!.images[0]!;
  const description = `${p.bullets.slice(0, 2).join('. ')}.`;
  return {
    title: p.title,
    description,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: {
      type: 'website',
      title: p.title,
      description,
      url: `/p/${p.slug}`,
      images: [{ url: image.url, width: image.width, height: image.height, alt: image.alt }],
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await getProduct((await params).slug);
  if (!product) notFound();
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${SITE_URL}/p/${product.slug}#product`,
    name: product.title,
    description: product.description,
    image: product.skus[0]!.images.map((i) => new URL(i.url, SITE_URL).toString()),
    sku: product.defaultSkuId,
    brand: { '@type': 'Brand', name: product.brand.name },
    category: product.categoryPath.map((c) => c.name).join(' > '),
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: product.rating,
      reviewCount: product.ratingCount,
    },
  };
  const leaf = product.categoryPath.at(-1);

  return (
    <PdpProvider product={product}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd).replace(/</g, '\\u003c') }}
      />
      <LiveEffects />
      <main className="mx-auto max-w-page bg-white px-3 pb-24 pt-3 md:px-4 lg:pb-8">
        <nav aria-label="Breadcrumb" className="mb-3 text-xs text-slate-700">
          <Link href="/" className="hover:underline">
            Home
          </Link>
          {product.categoryPath.map((c) => (
            <span key={c.slug}>
              {' › '}
              <Link href={`/c/${c.slug}`} className="hover:underline">
                {c.name}
              </Link>
            </span>
          ))}
        </nav>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,40fr)_minmax(0,35fr)_minmax(0,25fr)]">
          <Gallery />
          <div className="min-w-0 space-y-4">
            <div>
              <Link
                href={`/s?k=${encodeURIComponent(product.brand.name)}&brand=${product.brand.slug}`}
                className="text-sm text-brand-dark hover:underline"
              >
                Visit the {product.brand.name} Store
              </Link>
              <h1 className="mt-1 text-xl font-medium leading-snug md:text-2xl">{product.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold">{product.rating.toFixed(1)}</span>
                <a href="#reviews" className="hover:underline">
                  <RatingStars rating={product.rating} count={product.ratingCount} size="md" />
                </a>
                {product.boughtLastMonth > 0 && (
                  <span className="text-slate-700">
                    {formatCount(product.boughtLastMonth)}+ bought in past month
                  </span>
                )}
              </div>
            </div>
            <hr className="border-slate-200" />
            <PriceBlock />
            <Variants />
            <section aria-labelledby="about-heading">
              <h2 id="about-heading" className="mb-2 text-lg font-bold">
                About this item
              </h2>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {product.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
            <table className="w-full text-sm">
              <caption className="sr-only">Key specifications</caption>
              <tbody>
                {product.specs
                  .find((g) => g.group === 'Key specifications')
                  ?.rows.map((r) => (
                    <tr key={r.label}>
                      <th scope="row" className="w-2/5 py-1 pr-3 text-left font-semibold">
                        {r.label}
                      </th>
                      <td className="py-1">{r.value}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {/* Single column on mobile: delivery + stock follow the details, plus a sticky bar. */}
          <div>
            <BuyBox />
          </div>
        </div>
      </main>
      <div className="mx-auto mt-4 max-w-page space-y-4 px-3 md:px-4">
        <SectionCard title="Product description" headingId="desc">
          <p className="max-w-4xl text-sm leading-relaxed">{product.description}</p>
        </SectionCard>
        <SectionCard title="Specifications" headingId="specs">
          <div className="grid gap-6 md:grid-cols-2">
            {product.specs.map((g) => (
              <table key={g.group} className="w-full border border-slate-200 text-sm">
                <caption className="bg-slate-100 px-3 py-2 text-left font-semibold">
                  {g.group}
                </caption>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.label} className="border-t border-slate-200">
                      <th scope="row" className="w-2/5 bg-slate-50 px-3 py-2 text-left font-medium">
                        {r.label}
                      </th>
                      <td className="px-3 py-2">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </SectionCard>
        <ReviewsSection productId={product.id} slug={product.slug} />
        <QuestionsSection productId={product.id} slug={product.slug} />
        <ProductCarousel
          title="Customers who viewed this item also viewed"
          href={leaf ? `/c/${leaf.slug}` : undefined}
          items={product.alsoViewed}
        />
        <RecentlyViewed title="Your browsing history" excludeId={product.id} />
      </div>
      <MobileBuyBar />
    </PdpProvider>
  );
}
