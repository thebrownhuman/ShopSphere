import { Inject, Injectable } from '@nestjs/common';
import type { CategoryCrumb, CategoryNode } from '@shopsphere/types';
import { PrismaService } from '../shared/prisma/prisma.service';
import { resolveGstBp } from '../pricing/pricing';
import { CATALOG_CONFIG, CatalogConfig } from './catalog.config';

export interface CategoryRow {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  path: string;
  depth: number;
  position: number;
  gstRateBp: number | null;
  image: string | null;
}

const TTL_MS = 60_000;

/** Whole category table cached in memory (tens to low hundreds of rows), refreshed every 60 s. */
@Injectable()
export class CategoryTreeService {
  private cache?: { at: number; byId: Map<string, CategoryRow>; bySlug: Map<string, CategoryRow> };

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CATALOG_CONFIG) private readonly cfg: CatalogConfig,
  ) {}

  /** Category images are stored as API-relative paths (generated art) or absolute URLs. */
  imageUrl(image: string | null): string | null {
    if (!image) return null;
    return image.startsWith('http') ? image : `${this.cfg.API_URL}${image}`;
  }

  async load(): Promise<{ byId: Map<string, CategoryRow>; bySlug: Map<string, CategoryRow> }> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache;
    const rows = await this.prisma.category.findMany({
      orderBy: [{ depth: 'asc' }, { position: 'asc' }],
    });
    this.cache = {
      at: Date.now(),
      byId: new Map(rows.map((r) => [r.id, r])),
      bySlug: new Map(rows.map((r) => [r.slug, r])),
    };
    return this.cache;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  /** Self first, then ancestors up to the root. */
  async chain(categoryId: string): Promise<CategoryRow[]> {
    const { byId } = await this.load();
    const out: CategoryRow[] = [];
    let cur = byId.get(categoryId);
    while (cur && out.length < 10) {
      out.push(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  }

  async gstBp(categoryId: string): Promise<number> {
    return resolveGstBp(await this.chain(categoryId));
  }

  /** Root first. */
  async breadcrumbs(categoryId: string): Promise<CategoryCrumb[]> {
    return (await this.chain(categoryId))
      .reverse()
      .map(({ id, slug, name }) => ({ id, slug, name }));
  }

  async tree(): Promise<CategoryNode[]> {
    const { byId } = await this.load();
    const nodes = new Map<string, CategoryNode>();
    for (const r of byId.values()) {
      nodes.set(r.id, {
        id: r.id,
        slug: r.slug,
        name: r.name,
        path: r.path,
        depth: r.depth,
        image: this.imageUrl(r.image),
        children: [],
      });
    }
    const roots: CategoryNode[] = [];
    for (const r of byId.values()) {
      const node = nodes.get(r.id)!;
      const parent = r.parentId ? nodes.get(r.parentId) : undefined;
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  }
}
