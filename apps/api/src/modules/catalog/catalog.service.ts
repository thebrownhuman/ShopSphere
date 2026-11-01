import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ProductDetailResponse,
  ProductOffersResponse,
  SkuDetail,
  SpecGroup,
  VariantAttribute,
} from '@shopsphere/types';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CategoryTreeService } from './category-tree.service';
import { DiscoveryService } from './discovery.service';
import { colorHex, imageSet } from './media';
import { LoadedProduct, PRODUCT_INCLUDE, ProductLoader } from './product-loader';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = (what: string) =>
  new AppError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoryTreeService,
    private readonly products: ProductLoader,
    private readonly discovery: DiscoveryService,
  ) {}

  async productBySlug(slug: string, skuId?: string): Promise<ProductDetailResponse> {
    const row = await this.prisma.product.findUnique({ where: { slug }, include: PRODUCT_INCLUDE });
    if (!row || row.status !== 'ACTIVE' || row.skus.length === 0) throw notFound('Product');
    const p = await this.products.enrich(row);
    const selected = (skuId && p.skus.find((s) => s.sku.id === skuId)) || p.defaultSku;
    const [breadcrumbs, variantAttributes, alsoViewed] = await Promise.all([
      this.categories.breadcrumbs(row.categoryId),
      this.variantAttributes(p),
      this.discovery.alsoViewedIds(row.id).then((ids) => this.products.cards(ids)),
    ]);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      brand: { id: row.brand.id, slug: row.brand.slug, name: row.brand.name },
      breadcrumbs,
      description: row.description,
      bullets: (row.bullets as string[]) ?? [],
      specs: (row.specs as unknown as SpecGroup[]) ?? [],
      rating: row.ratingX10 / 10,
      ratingCount: row.ratingCount,
      boughtLastMonth: row.boughtLastMonth,
      returnDays: row.returnDays,
      countryOfOrigin: row.countryOfOrigin,
      variantAttributes,
      skus: p.skus.map((s) => this.skuDetail(p, s)),
      selectedSkuId: selected.sku.id,
      alsoViewed,
    };
  }

  async offers(productId: string, skuId?: string): Promise<ProductOffersResponse> {
    if (!UUID.test(productId)) throw notFound('Product');
    const [p] = await this.products.loadMany([productId]);
    if (!p) throw notFound('Product');
    const s = skuId ? p.skus.find((x) => x.sku.id === skuId) : p.defaultSku;
    if (!s) throw notFound('SKU');
    return {
      productId: p.row.id,
      skuId: s.sku.id,
      buyBoxOfferId: s.ranked[0]?.id ?? null,
      offers: s.ranked.map((o) => this.products.offerView(o, p.gstBp)),
    };
  }

  private skuDetail(p: LoadedProduct, s: LoadedProduct['skus'][number]): SkuDetail {
    const own = p.row.images.filter((i) => i.skuId === s.sku.id && i.status === 'READY');
    const shared = p.row.images.filter((i) => i.skuId === null && i.status === 'READY');
    const images = (own.length > 0 ? [...own, ...shared] : shared)
      .slice(0, 9)
      .map((i) => imageSet(i, this.products.bases))
      .filter((i) => i !== null);
    const others = s.ranked.slice(1);
    return {
      id: s.sku.id,
      attributes: s.sku.attributes as Record<string, string>,
      images,
      buyBox: s.ranked[0] ? this.products.offerView(s.ranked[0], p.gstBp) : null,
      otherOfferCount: others.length,
      otherOffersFrom: others.length
        ? Number(others.reduce((m, o) => (o.price < m ? o.price : m), others[0].price))
        : null,
    };
  }

  private async variantAttributes(p: LoadedProduct): Promise<VariantAttribute[]> {
    const chain = await this.categories.chain(p.row.categoryId);
    const defs = await this.prisma.attributeDefinition.findMany({
      where: { categoryId: { in: chain.map((c) => c.id) }, isVariant: true },
      orderBy: { position: 'asc' },
    });
    const keys = new Map<string, { label: string; type: string }>();
    for (const d of defs) if (!keys.has(d.key)) keys.set(d.key, { label: d.label, type: d.type });
    // Keys present on SKUs but undefined in the schema still get a selector.
    for (const s of p.skus) {
      for (const k of Object.keys(s.sku.attributes as object)) {
        if (!keys.has(k)) keys.set(k, { label: k[0].toUpperCase() + k.slice(1), type: 'TEXT' });
      }
    }
    const out: VariantAttribute[] = [];
    for (const [key, def] of keys) {
      const values = new Map<string, boolean>();
      for (const s of p.skus) {
        const v = (s.sku.attributes as Record<string, string>)[key];
        if (v !== undefined) values.set(v, (values.get(v) ?? false) || s.ranked.length > 0);
      }
      if (values.size < 2 && p.skus.length > 1) continue;
      if (values.size === 0) continue;
      out.push({
        key,
        label: def.label,
        options: [...values].map(([value, available]) => {
          const swatch = def.type === 'COLOR' ? colorHex(value) : undefined;
          return { value, available, ...(swatch ? { swatch } : {}) };
        }),
      });
    }
    return out;
  }
}
