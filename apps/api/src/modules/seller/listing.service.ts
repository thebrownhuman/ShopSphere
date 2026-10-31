import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ListingCreated,
  ListingRequest,
  SellerAttribute,
  SellerCategory,
} from '@shopsphere/types';
import { productChanged } from '../catalog/catalog-events';
import { CategoryTreeService } from '../catalog/category-tree.service';
import { SearchIndexerService } from '../search/search-indexer.service';
import { AppError } from '../shared/errors/app-error';
import { OutboxService } from '../shared/outbox/outbox.service';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import { slugify } from './seller-account.service';

export interface ListingIssue {
  field: string;
  message: string;
}

export const MAX_STOCK = 100_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKU_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

/**
 * Structural checks shared by the single listing form (M5.2) and bulk upload (M5.3). Category
 * and SKU-code uniqueness are checked against the database separately.
 */
export function validateListing(req: ListingRequest, attrs: SellerAttribute[]): ListingIssue[] {
  const issues: ListingIssue[] = [];
  const variantKeys = new Set(attrs.filter((a) => a.isVariant).map((a) => a.key));
  const specKeys = new Set(attrs.filter((a) => !a.isVariant).map((a) => a.key));
  if (req.title.trim().length < 3) issues.push({ field: 'title', message: 'Title is too short' });
  if (req.title.length > 200) issues.push({ field: 'title', message: 'Max 200 characters' });
  if (!req.brand.trim()) issues.push({ field: 'brand', message: 'Brand is required' });
  for (const k of Object.keys(req.specs ?? {})) {
    if (!specKeys.has(k)) issues.push({ field: `specs.${k}`, message: 'Unknown attribute' });
  }
  if (req.variants.length === 0) {
    issues.push({ field: 'variants', message: 'Add at least one variant' });
  }
  if (req.variants.length > 100) issues.push({ field: 'variants', message: 'Max 100 variants' });
  const combos = new Set<string>();
  const codes = new Set<string>();
  req.variants.forEach((v, i) => {
    const at = (f: string) => `variants[${i}].${f}`;
    const entries = Object.entries(v.attributes).filter(([, val]) => val.trim() !== '');
    for (const [k] of entries) {
      if (!variantKeys.has(k))
        issues.push({ field: at(k), message: `${k} is not a variant attribute` });
    }
    if (req.variants.length > 1 && entries.length === 0) {
      issues.push({ field: at('attributes'), message: 'Variants need at least one variant value' });
    }
    const combo = JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
    if (combos.has(combo)) issues.push({ field: at('attributes'), message: 'Duplicate variant' });
    combos.add(combo);
    if (v.skuCode !== undefined) {
      if (!SKU_CODE_RE.test(v.skuCode)) {
        issues.push({ field: at('skuCode'), message: '3-64 letters, digits, . _ -' });
      } else if (codes.has(v.skuCode.toUpperCase())) {
        issues.push({ field: at('skuCode'), message: 'Duplicate SKU code' });
      }
      codes.add(v.skuCode.toUpperCase());
    }
    if (!Number.isSafeInteger(v.price) || v.price <= 0) {
      issues.push({ field: at('price'), message: 'Price must be a positive amount' });
    }
    if (!Number.isSafeInteger(v.mrp) || v.mrp <= 0) {
      issues.push({ field: at('mrp'), message: 'MRP must be a positive amount' });
    } else if (v.mrp < v.price) {
      issues.push({ field: at('mrp'), message: 'MRP cannot be below the selling price' });
    }
    if (!Number.isInteger(v.stock) || v.stock < 0 || v.stock > MAX_STOCK) {
      issues.push({ field: at('stock'), message: `Stock must be 0-${MAX_STOCK}` });
    }
  });
  return issues;
}

/** Listing creation (M5.2): product + SKUs + images + this seller's offers, then search indexing. */
@Injectable()
export class ListingService {
  private readonly logger = new Logger(ListingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoryTreeService,
    private readonly outbox: OutboxService,
    private readonly indexer: SearchIndexerService,
  ) {}

  /** Leaf categories a seller can list in. */
  async leafCategories(): Promise<SellerCategory[]> {
    const { byId } = await this.categories.load();
    const parents = new Set([...byId.values()].map((c) => c.parentId).filter(Boolean));
    const out: SellerCategory[] = [];
    for (const c of byId.values()) {
      if (parents.has(c.id)) continue;
      const chain = (await this.categories.chain(c.id)).reverse();
      out.push({
        id: c.id,
        name: c.name,
        path: c.path,
        pathLabel: chain.map((x) => x.name).join(' › '),
      });
    }
    return out.sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));
  }

  /** Attribute schema for a leaf category, nearest definition wins. */
  async attributes(categoryId: string): Promise<SellerAttribute[]> {
    await this.requireLeaf(categoryId);
    const chain = await this.categories.chain(categoryId);
    const defs = await this.prisma.attributeDefinition.findMany({
      where: { categoryId: { in: chain.map((c) => c.id) } },
      orderBy: { position: 'asc' },
    });
    const depth = new Map(chain.map((c, i) => [c.id, i]));
    defs.sort(
      (a, b) => depth.get(a.categoryId)! - depth.get(b.categoryId)! || a.position - b.position,
    );
    const seen = new Map<string, SellerAttribute>();
    for (const d of defs) {
      if (!seen.has(d.key)) {
        seen.set(d.key, {
          key: d.key,
          label: d.label,
          type: d.type as SellerAttribute['type'],
          isVariant: d.isVariant,
        });
      }
    }
    return [...seen.values()];
  }

  async requireLeaf(categoryId: string): Promise<void> {
    const { byId } = await this.categories.load();
    if (!UUID_RE.test(categoryId) || !byId.has(categoryId)) {
      throw new AppError('LISTING_INVALID', 'Unknown category', 422, [
        { field: 'categoryId', message: 'Unknown category' },
      ]);
    }
    if ([...byId.values()].some((c) => c.parentId === categoryId)) {
      throw new AppError('LISTING_INVALID', 'Pick a leaf category', 422, [
        { field: 'categoryId', message: 'Pick a leaf category' },
      ]);
    }
  }

  /** Validates, creates and indexes one listing. */
  async create(
    seller: { sellerId: string; accountId: string; isFirstParty: boolean },
    req: ListingRequest,
  ): Promise<ListingCreated> {
    const attrs = await this.attributes(req.categoryId);
    const issues = validateListing(req, attrs);
    if (issues.length) throw new AppError('LISTING_INVALID', issues[0].message, 422, issues);
    const created = await this.prisma.$transaction((tx) => this.insert(tx, seller, req, attrs));
    await this.index([created.productId]);
    return created;
  }

  /** Inserts an already-validated listing inside the caller's transaction. */
  async insert(
    tx: Tx,
    seller: { sellerId: string; accountId: string; isFirstParty: boolean },
    req: ListingRequest,
    attrs: SellerAttribute[],
  ): Promise<ListingCreated> {
    const codes = req.variants.map((v) => (v.skuCode ?? autoSkuCode()).toUpperCase());
    const taken = await tx.sku.findMany({ where: { code: { in: codes } }, select: { code: true } });
    if (taken.length) {
      throw new AppError('SKU_EXISTS', `SKU code ${taken[0].code} already exists`, 409, {
        codes: taken.map((t) => t.code),
      });
    }
    await this.assertOwnMedia(tx, seller.accountId, [
      ...(req.images ?? []),
      ...req.variants.flatMap((v) => v.images ?? []),
    ]);

    const brandName = req.brand.trim();
    const brandSlug = slugify(brandName) || 'generic';
    const brand = await tx.brand.upsert({
      where: { slug: brandSlug },
      update: {},
      create: { slug: brandSlug, name: brandName },
    });
    const labels = new Map(attrs.map((a) => [a.key, a.label]));
    const specItems = Object.entries(req.specs ?? {})
      .filter(([, v]) => v.trim())
      .map(([k, v]) => ({ label: labels.get(k) ?? k, value: v.trim() }));
    const slug = `${slugify(req.title) || 'product'}-${randomBytes(3).toString('hex')}`;
    const product = await tx.product.create({
      data: {
        slug,
        title: req.title.trim(),
        brandId: brand.id,
        categoryId: req.categoryId,
        description: req.description?.trim() ?? '',
        bullets: (req.bullets ?? []).map((b) => b.trim()).filter(Boolean),
        specs: specItems.length ? [{ group: 'General', items: specItems }] : [],
        status: 'ACTIVE',
      },
    });

    const images: Prisma.ProductImageCreateManyInput[] = [];
    const addImages = (refs: string[] | undefined, skuId: string | null) =>
      (refs ?? []).forEach((ref) =>
        images.push({
          productId: product.id,
          skuId,
          position: images.length,
          alt: req.title.trim(),
          sourceUrl: UUID_RE.test(ref) ? `/seller/media/${ref}` : ref,
        }),
      );
    addImages(req.images, null);

    const skus: ListingCreated['skus'] = [];
    for (const [i, v] of req.variants.entries()) {
      const attributes = Object.fromEntries(
        Object.entries(v.attributes)
          .map(([k, val]) => [k, val.trim()] as const)
          .filter(([, val]) => val),
      );
      const sku = await tx.sku.create({
        data: {
          productId: product.id,
          code: codes[i],
          attributes,
          isDefault: i === 0,
          position: i,
        },
      });
      const offer = await tx.offer.create({
        data: {
          skuId: sku.id,
          sellerId: seller.sellerId,
          price: BigInt(v.price),
          mrp: BigInt(v.mrp),
          stockQty: v.stock,
          fulfilment: seller.isFirstParty ? 'SHOPSPHERE' : 'SELLER',
        },
      });
      addImages(v.images, sku.id);
      skus.push({ skuId: sku.id, code: sku.code, offerId: offer.id });
    }
    if (images.length === 0) {
      images.push({
        productId: product.id,
        position: 0,
        alt: req.title.trim(),
        sourceUrl: `/media/ph/${product.id}.svg?label=${encodeURIComponent(brandName)}`,
      });
    }
    await tx.productImage.createMany({ data: images });
    await productChanged(this.outbox, tx, product.id);
    return { productId: product.id, slug, skus };
  }

  /**
   * Indexes right away so a new listing is searchable without waiting for the indexer worker;
   * the outbox event still lets the worker retry if OpenSearch is down now.
   */
  async index(productIds: string[]): Promise<void> {
    try {
      await this.indexer.indexProducts(productIds, true);
    } catch (err) {
      this.logger.warn(`search indexing deferred to worker: ${(err as Error).message}`);
    }
  }

  private async assertOwnMedia(tx: Tx, accountId: string, refs: string[]): Promise<void> {
    const ids = refs.filter((r) => UUID_RE.test(r));
    const urls = refs.filter((r) => !UUID_RE.test(r));
    const badUrl = urls.find((u) => !/^https?:\/\/\S+$/.test(u));
    if (badUrl) {
      throw new AppError('LISTING_INVALID', 'Images must be uploads or http(s) URLs', 422, [
        { field: 'images', message: `Invalid image ${badUrl.slice(0, 80)}` },
      ]);
    }
    if (!ids.length) return;
    const own = await tx.sellerMedia.count({
      where: { id: { in: [...new Set(ids)] }, sellerAccountId: accountId },
    });
    if (own !== new Set(ids).size) {
      throw new AppError('LISTING_INVALID', 'Unknown image upload', 422, [
        { field: 'images', message: 'Unknown image upload' },
      ]);
    }
  }
}

function autoSkuCode(): string {
  return `SS-${randomBytes(5).toString('hex').toUpperCase()}`;
}
