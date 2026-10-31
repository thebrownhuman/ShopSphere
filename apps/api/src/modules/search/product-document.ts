import type { ImageSet, ProductCard } from '@shopsphere/types';
import type { CategoryRow } from '../catalog/category-tree.service';
import { priceInfo } from '../pricing/pricing';

/** Shape of a document in the product index (see index-mapping.ts). */
export interface ProductDoc {
  productId: string;
  skuId: string;
  slug: string;
  title: string;
  brand: string;
  brandSlug: string;
  /** "slug|Name" for facet labels without a DB round trip. */
  brandKv: string;
  categoryIds: string[];
  /** Leaf and all ancestors, so filtering on a parent category matches. */
  categorySlugs: string[];
  categoryKv: string;
  categoryNames: string;
  /** "key=value" for every SKU's attributes plus filterable specs. */
  attrKv: string[];
  attrText: string;
  price: number | null;
  mrp: number | null;
  gstBp: number;
  discount: number;
  rating: number;
  ratingCount: number;
  salesRank: number;
  popularity: number;
  inStock: boolean;
  plus: boolean;
  sellerIds: string[];
  createdAt: string;
  image: ImageSet | null;
}

/** Sales rank 1 → ~1.0, 1M → ~0.0; feeds the ranking function with a log1p modifier. */
export function popularityFromRank(rank: number): number {
  return Math.round((10 / Math.log10(rank + 10)) * 1000) / 1000;
}

export interface DocInput {
  card: ProductCard;
  brandSlug: string;
  /** Self first, then ancestors. */
  chain: CategoryRow[];
  gstBp: number;
  skuAttributes: Record<string, string>[];
  /** Spec values for filterable attribute keys. */
  filterableSpecs: Record<string, string>;
  salesRank: number;
  sellerIds: string[];
  createdAt: Date;
}

export function buildProductDoc(i: DocInput): ProductDoc {
  const kv = new Set<string>();
  for (const attrs of i.skuAttributes)
    for (const [k, v] of Object.entries(attrs)) kv.add(`${k}=${v}`);
  for (const [k, v] of Object.entries(i.filterableSpecs)) kv.add(`${k}=${v}`);
  const leaf = i.chain[0];
  return {
    productId: i.card.productId,
    skuId: i.card.skuId,
    slug: i.card.slug,
    title: i.card.title,
    brand: i.card.brand,
    brandSlug: i.brandSlug,
    brandKv: `${i.brandSlug}|${i.card.brand}`,
    categoryIds: i.chain.map((c) => c.id),
    categorySlugs: i.chain.map((c) => c.slug),
    categoryKv: leaf ? `${leaf.slug}|${leaf.name}` : '',
    categoryNames: i.chain.map((c) => c.name).join(' '),
    attrKv: [...kv],
    attrText: [...kv].map((x) => x.split('=')[1]).join(' '),
    price: i.card.pricing?.price ?? null,
    mrp: i.card.pricing?.mrp ?? null,
    gstBp: i.gstBp,
    discount: i.card.pricing?.discountPercent ?? 0,
    rating: i.card.rating,
    ratingCount: i.card.ratingCount,
    salesRank: i.salesRank,
    popularity: popularityFromRank(i.salesRank),
    inStock: i.card.inStock,
    plus: i.card.plus,
    sellerIds: i.sellerIds,
    createdAt: i.createdAt.toISOString(),
    image: i.card.image,
  };
}

export function cardFromDoc(d: ProductDoc): ProductCard {
  return {
    productId: d.productId,
    skuId: d.skuId,
    slug: d.slug,
    title: d.title,
    brand: d.brand,
    image: d.image,
    rating: d.rating,
    ratingCount: d.ratingCount,
    pricing: d.price != null && d.mrp != null ? priceInfo(d.price, d.mrp, d.gstBp) : null,
    inStock: d.inStock,
    plus: d.plus,
  };
}
