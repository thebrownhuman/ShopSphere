'use client';

import { useEffect } from 'react';
import { recordView } from '@/lib/recently-viewed';
import { SITE_URL } from '@/lib/site';
import { useOffers, usePdp } from './pdp-context';

/**
 * Side effects that need the live offer: schema.org Offer JSON-LD (kept out of the ISR HTML so a
 * cached page never advertises a stale price) and the recently-viewed entry.
 */
export function LiveEffects() {
  const { product, sku } = usePdp();
  const { data } = useOffers();
  const offer = data?.buyBox;

  useEffect(() => {
    if (!data) return;
    recordView({
      id: product.id,
      slug: product.slug,
      skuId: sku.id,
      title: product.title,
      brand: product.brand.name,
      image: sku.images[0]!,
      rating: product.rating,
      ratingCount: product.ratingCount,
      price: offer?.price ?? 0,
      mrp: offer?.mrp ?? 0,
      plus: offer?.fulfilment === 'SHOPSPHERE',
      inStock: !!offer,
      deliveryDays: offer?.fulfilment === 'SHOPSPHERE' ? 1 : 3,
    });
  }, [data, offer, product, sku]);

  if (!data) return null;
  const url = `${SITE_URL}/p/${product.slug}${sku.id === product.defaultSkuId ? '' : `?sku=${sku.id}`}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Offer',
    '@id': `${url}#offer`,
    url,
    sku: sku.id,
    itemOffered: { '@id': `${SITE_URL}/p/${product.slug}#product` },
    priceCurrency: 'INR',
    price: offer ? (offer.price / 100).toFixed(2) : undefined,
    availability: offer ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    seller: offer ? { '@type': 'Organization', name: offer.sellerName } : undefined,
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
    />
  );
}
