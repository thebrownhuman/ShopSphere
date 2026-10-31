import { Injectable, Logger } from '@nestjs/common';
import type { HomeResponse, HomeSection, ProductCard, QuadCard } from '@shopsphere/types';
import { CategoryTreeService } from '../catalog/category-tree.service';
import { DiscoveryService } from '../catalog/discovery.service';
import { imageSet } from '../catalog/media';
import { ProductLoader } from '../catalog/product-loader';
import type { Viewer } from '../catalog/viewer';
import { OpenSearchClient } from '../search/opensearch.client';
import { cardFromDoc, ProductDoc } from '../search/product-document';
import { buildSearchBody, parseSearchParams } from '../search/search-query';
import { PrismaService } from '../shared/prisma/prisma.service';

/** Search-style product query stored in home_sections.data_source (same keys as GET /search). */
type ProductQuery = Record<string, string>;

interface BannerSource {
  id: string;
  title: string;
  subtitle?: string;
  imageSeed: string;
  href: string;
}

interface QuadCardSource {
  title: string;
  /** recently_viewed: viewer's history; categories: one tile per category slug. */
  source: 'recently_viewed' | 'categories' | 'sign_in';
  categorySlugs?: string[];
  cta?: { label: string; href: string };
}

interface SectionData {
  banners?: BannerSource[];
  cards?: QuadCardSource[];
  query?: ProductQuery;
  /** Personalised carousels: "also_viewed_history" (Inspired by your browsing). */
  personal?: 'also_viewed_history';
  limit?: number;
  seeAllHref?: string;
  categorySlugs?: string[];
}

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Today's deals end at the next IST midnight. */
export function nextIstMidnight(now: Date): Date {
  const t = now.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(t / DAY_MS) * DAY_MS + DAY_MS - IST_OFFSET_MS);
}

/** Simulated "% claimed" that is stable for a product within a day and creeps up over it. */
export function claimedPercent(productId: string, now: Date): number {
  let h = 0;
  for (const c of productId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const dayFraction = ((now.getTime() + IST_OFFSET_MS) % DAY_MS) / DAY_MS;
  return Math.min(98, 10 + (h % 50) + Math.floor(dayFraction * 38));
}

@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly os: OpenSearchClient,
    private readonly products: ProductLoader,
    private readonly discovery: DiscoveryService,
    private readonly categories: CategoryTreeService,
  ) {}

  async home(viewer: Viewer, now = new Date()): Promise<HomeResponse> {
    const rows = await this.prisma.homeSection.findMany({
      where: {
        active: true,
        audience: { in: ['ALL', viewer.userId ? 'SIGNED_IN' : 'GUEST'] },
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: { position: 'asc' },
    });
    const recent = viewer.ownerKey ? await this.discovery.recentlyViewed(viewer.ownerKey) : [];
    const built = await Promise.all(
      rows.map((r) =>
        this.build(
          r.id,
          r.type,
          r.title,
          r.position,
          r.dataSource as SectionData,
          recent,
          now,
        ).catch((err: unknown) => {
          // One broken row (bad CMS data, search hiccup) must not take down the home page.
          this.logger.warn({ section: r.id, err: String(err) }, 'home section failed');
          return null;
        }),
      ),
    );
    return { sections: built.filter((s): s is HomeSection => s !== null) };
  }

  private async build(
    id: string,
    type: string,
    title: string,
    position: number,
    d: SectionData,
    recent: ProductCard[],
    now: Date,
  ): Promise<HomeSection | null> {
    const base = { id, title, position };
    const bases = this.products.bases;
    switch (type) {
      case 'HERO_CAROUSEL':
        return {
          ...base,
          type,
          banners: (d.banners ?? []).map((b) => ({
            id: b.id,
            title: b.title,
            subtitle: b.subtitle ?? null,
            image: imageSet(
              {
                alt: b.title,
                storageKey: null,
                sourceUrl: `/media/ph/${b.imageSeed}.svg?label=${encodeURIComponent(b.title)}`,
              },
              bases,
            )!,
            href: b.href,
          })),
        };
      case 'QUAD_CARDS': {
        const cards = (
          await Promise.all((d.cards ?? []).map((c) => this.quadCard(c, recent)))
        ).filter((c): c is QuadCard => c !== null);
        return cards.length ? { ...base, type, cards } : null;
      }
      case 'DEAL_ROW': {
        const products = await this.query(
          d.query ?? { discount: '40', inStock: 'true' },
          d.limit ?? 12,
        );
        if (!products.length) return null;
        const endsAt = nextIstMidnight(now).toISOString();
        return {
          ...base,
          type,
          deals: products.map((product) => ({
            product,
            endsAt,
            claimedPercent: claimedPercent(product.productId, now),
          })),
          seeAllHref: d.seeAllHref ?? null,
        };
      }
      case 'PRODUCT_CAROUSEL': {
        let products: ProductCard[];
        if (d.personal === 'also_viewed_history') {
          const seeds = recent.slice(0, 3).map((p) => p.productId);
          const ids = (
            await Promise.all(seeds.map((s) => this.discovery.alsoViewedIds(s, 8)))
          ).flat();
          const seen = new Set(recent.map((p) => p.productId));
          products = await this.products.cards(
            [...new Set(ids)].filter((x) => !seen.has(x)).slice(0, d.limit ?? 12),
          );
        } else {
          products = await this.query(d.query ?? {}, d.limit ?? 12);
        }
        return products.length
          ? { ...base, type, products, seeAllHref: d.seeAllHref ?? null }
          : null;
      }
      case 'RECENTLY_VIEWED':
        return recent.length ? { ...base, type, products: recent } : null;
      case 'CATEGORY_TILES': {
        const { bySlug } = await this.categories.load();
        const categories = (d.categorySlugs ?? [])
          .map((s) => bySlug.get(s))
          .filter((c) => c !== undefined)
          .map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            image: this.categories.imageUrl(c.image),
          }));
        return categories.length ? { ...base, type, categories } : null;
      }
      default:
        return null;
    }
  }

  private async quadCard(c: QuadCardSource, recent: ProductCard[]): Promise<QuadCard | null> {
    if (c.source === 'recently_viewed') {
      if (recent.length === 0) return null;
      return {
        title: c.title,
        tiles: recent
          .slice(0, 4)
          .map((p) => ({ title: p.title, image: p.image, href: `/p/${p.slug}` })),
        cta: c.cta ?? null,
      };
    }
    if (c.source === 'sign_in')
      return {
        title: c.title,
        tiles: [],
        cta: c.cta ?? { label: 'Sign in securely', href: '/signin' },
      };
    const { bySlug } = await this.categories.load();
    const tiles = (c.categorySlugs ?? [])
      .map((s) => bySlug.get(s))
      .filter((x) => x !== undefined)
      .slice(0, 4)
      .map((cat) => ({
        title: cat.name,
        image: cat.image
          ? imageSet({ alt: cat.name, storageKey: null, sourceUrl: cat.image }, this.products.bases)
          : null,
        href: `/s?category=${cat.slug}`,
      }));
    return tiles.length ? { title: c.title, tiles, cta: c.cta ?? null } : null;
  }

  private async query(q: ProductQuery, limit: number): Promise<ProductCard[]> {
    const body = buildSearchBody(parseSearchParams({ ...q, pageSize: String(limit) }));
    delete body.aggs;
    delete body.suggest;
    const res = await this.os.search<{ hits: { hits: { _source: ProductDoc }[] } }>(body);
    return res.hits.hits.map((h) => cardFromDoc(h._source));
  }
}
