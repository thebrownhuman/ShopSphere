import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CartGroup,
  CartLine,
  CartResponse,
  ImageSet,
  ProductCard,
  SavedItem,
} from '@shopsphere/types';
import { imageSet } from '../catalog/media';
import { DiscoveryService } from '../catalog/discovery.service';
import { ProductLoader, rankOffers, type LoadedProduct } from '../catalog/product-loader';
import { estimateDelivery, isValidPincode } from '../delivery/delivery-estimate';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import { CART_CONFIG, type CartConfig } from './cart.config';
import {
  lineCap,
  planMerge,
  priceLine,
  summarise,
  type LiveOffer,
  type PricingLimits,
} from './cart-pricing';
import { newGuestToken } from './guest-cookie';

/** Who owns the cart: a signed-in user, or a guest token from the guest_cart cookie (may be absent). */
export type CartOwner = { userId: string } | { guestToken: string | null };

const CART_INCLUDE = {
  items: { orderBy: { addedAt: 'asc' } },
  saved: { orderBy: { savedAt: 'desc' } },
} satisfies Prisma.CartInclude;

type OfferWithSeller = Prisma.OfferGetPayload<{ include: { seller: true } }>;

function live(offer: OfferWithSeller | undefined, productActive: boolean): LiveOffer | null {
  if (!offer) return null;
  return {
    price: Number(offer.price),
    mrp: Number(offer.mrp),
    available: offer.stockQty - offer.reservedQty,
    maxPerOrder: offer.maxPerOrder,
    active: productActive && offer.status === 'ACTIVE' && offer.seller.status === 'ACTIVE',
  };
}

const unavailable = (message: string, code = 'OFFER_UNAVAILABLE') =>
  new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY);

/**
 * Cart (M3.1–M3.6). Every write runs in a transaction holding `SELECT … FOR UPDATE` on the cart
 * row, so two tabs editing the same cart serialise instead of losing updates or breaking limits.
 * Stock is checked, never reserved, at add-to-cart (reservation happens at payment start, M4).
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductLoader,
    private readonly discovery: DiscoveryService,
    @Inject(CART_CONFIG) private readonly cfg: CartConfig,
  ) {}

  get limits() {
    return { maxLines: this.cfg.CART_MAX_LINES, maxQtyPerItem: this.cfg.CART_MAX_QTY_PER_ITEM };
  }

  private get pricing(): PricingLimits {
    return {
      maxQtyPerItem: this.cfg.CART_MAX_QTY_PER_ITEM,
      freeDeliveryThreshold: this.cfg.CART_FREE_DELIVERY_MIN_PAISE,
    };
  }

  private guestExpiry(): Date {
    return new Date(Date.now() + this.cfg.GUEST_CART_DAYS * 86_400_000);
  }

  // ───────── Ownership ─────────

  async findCartId(owner: CartOwner, db: Tx = this.prisma): Promise<string | null> {
    if ('userId' in owner) {
      const c = await db.cart.findFirst({
        where: { userId: owner.userId, status: 'ACTIVE' },
        select: { id: true },
      });
      return c?.id ?? null;
    }
    if (!owner.guestToken) return null;
    const c = await db.cart.findFirst({
      where: { guestToken: owner.guestToken, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return c?.id ?? null;
  }

  /** Finds or creates the owner's cart. A guest without a live cart gets a fresh token. */
  async ensureCart(owner: CartOwner): Promise<{ cartId: string; guestToken?: string }> {
    const found = await this.findCartId(owner);
    if (found) return { cartId: found };
    if ('userId' in owner) {
      // Partial unique index carts_user_active_key makes concurrent creation safe.
      await this.prisma.$executeRaw`
        INSERT INTO carts (user_id, updated_at) VALUES (${owner.userId}::uuid, now())
        ON CONFLICT DO NOTHING`;
      return { cartId: (await this.findCartId(owner))! };
    }
    const guestToken = newGuestToken();
    const cart = await this.prisma.cart.create({
      data: { guestToken, expiresAt: this.guestExpiry() },
      select: { id: true },
    });
    return { cartId: cart.id, guestToken };
  }

  private async requireCart(owner: CartOwner): Promise<string> {
    const id = await this.findCartId(owner);
    if (!id) throw new AppError('LINE_NOT_FOUND', 'That item is no longer in your cart', 404);
    return id;
  }

  /** Runs `fn` holding the cart row lock, then bumps the version (and a guest cart's expiry). */
  private locked<T>(cartId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM carts WHERE id = ${cartId}::uuid FOR UPDATE`;
      if (rows[0]?.status !== 'ACTIVE') {
        throw new AppError('CART_CHANGED', 'Your cart changed. Please try again.', 409);
      }
      const out = await fn(tx);
      await tx.$executeRaw`
        UPDATE carts SET version = version + 1, updated_at = now(),
          expires_at = CASE WHEN guest_token IS NULL OR user_id IS NOT NULL THEN expires_at
                            ELSE ${this.guestExpiry()} END
        WHERE id = ${cartId}::uuid`;
      return out;
    });
  }

  // ───────── Validation (M3.3) ─────────

  async checkPincode(pincode: string): Promise<void> {
    if (!isValidPincode(pincode)) {
      throw new AppError('INVALID_PINCODE', 'Enter a valid 6-digit pincode', 400);
    }
    const pin = await this.prisma.pincode.findUnique({ where: { pincode } });
    if (pin?.serviceable === false) {
      throw unavailable(`Not deliverable to ${pincode}`, 'NOT_SERVICEABLE');
    }
  }

  /** Active SKU + live offer (given seller, else the buy-box winner). */
  private async resolveOffer(tx: Tx, skuId: string, sellerId?: string) {
    const sku = await tx.sku.findUnique({
      where: { id: skuId },
      include: {
        product: { select: { id: true, status: true } },
        offers: { include: { seller: true } },
      },
    });
    if (!sku || sku.product.status !== 'ACTIVE') {
      throw unavailable('This item is no longer available', 'SKU_UNAVAILABLE');
    }
    const offer = sellerId
      ? sku.offers.find((o) => o.sellerId === sellerId)
      : rankOffers(sku.offers)[0];
    if (!offer || offer.status !== 'ACTIVE' || offer.seller.status !== 'ACTIVE') {
      throw unavailable('This seller is not selling this item right now');
    }
    return { productId: sku.product.id, offer };
  }

  private checkQty(offer: OfferWithSeller, qty: number): void {
    const available = offer.stockQty - offer.reservedQty;
    if (available <= 0) {
      throw new AppError('INSUFFICIENT_STOCK', 'This item is out of stock', 409, { available: 0 });
    }
    const limit = Math.min(offer.maxPerOrder, this.cfg.CART_MAX_QTY_PER_ITEM);
    if (qty > available && available < limit) {
      throw new AppError('INSUFFICIENT_STOCK', `Only ${available} available`, 409, { available });
    }
    if (qty > limit) {
      throw new AppError('QTY_LIMIT', `You can buy only ${limit} of this item`, 409, { limit });
    }
  }

  // ───────── Commands ─────────

  async addItem(
    owner: CartOwner,
    input: { sku: string; sellerId?: string; qty: number },
    pincode: string,
  ): Promise<{ cartId: string; lineId: string; productId: string; guestToken?: string }> {
    await this.checkPincode(pincode);
    const { cartId, guestToken } = await this.ensureCart(owner);
    const { lineId, productId } = await this.locked(cartId, async (tx) => {
      const { productId, offer } = await this.resolveOffer(tx, input.sku, input.sellerId);
      const where = { cartId, skuId: input.sku, sellerId: offer.sellerId };
      const existing = await tx.cartItem.findUnique({ where: { cartId_skuId_sellerId: where } });
      if (!existing && (await tx.cartItem.count({ where: { cartId } })) >= this.cfg.CART_MAX_LINES) {
        throw new AppError(
          'CART_FULL',
          `Your cart can hold up to ${this.cfg.CART_MAX_LINES} different items`,
          409,
          { maxLines: this.cfg.CART_MAX_LINES },
        );
      }
      this.checkQty(offer, (existing?.qty ?? 0) + input.qty);
      const data = { offerId: offer.id, priceSnapshot: offer.price };
      const line = existing
        ? await tx.cartItem.update({
            where: { id: existing.id },
            data: { ...data, qty: existing.qty + input.qty },
          })
        : await tx.cartItem.create({ data: { ...where, ...data, productId, qty: input.qty } });
      await tx.savedItem.deleteMany({ where });
      return { lineId: line.id, productId };
    });
    return { cartId, lineId, productId, guestToken };
  }

  /** Sets a line's quantity. Lowering is always allowed; raising re-validates stock and limits. */
  async updateItem(owner: CartOwner, lineId: string, qty: number): Promise<string> {
    const cartId = await this.requireCart(owner);
    await this.locked(cartId, async (tx) => {
      const line = await tx.cartItem.findFirst({ where: { id: lineId, cartId } });
      if (!line) throw new AppError('LINE_NOT_FOUND', 'That item is no longer in your cart', 404);
      if (qty > line.qty) {
        const { offer } = await this.resolveOffer(tx, line.skuId, line.sellerId);
        this.checkQty(offer, qty);
      }
      await tx.cartItem.update({ where: { id: line.id }, data: { qty } });
    });
    return cartId;
  }

  /** Idempotent: deleting a line another tab already removed is not an error. */
  async removeItem(owner: CartOwner, lineId: string): Promise<{ cartId: string | null; removed: boolean }> {
    const cartId = await this.findCartId(owner);
    if (!cartId) return { cartId: null, removed: false };
    const removed = await this.locked(cartId, async (tx) => {
      const r = await tx.cartItem.deleteMany({ where: { id: lineId, cartId } });
      return r.count > 0;
    });
    return { cartId, removed };
  }

  async saveForLater(owner: CartOwner, lineId: string): Promise<string> {
    const cartId = await this.requireCart(owner);
    await this.locked(cartId, async (tx) => {
      const line = await tx.cartItem.findFirst({ where: { id: lineId, cartId } });
      if (!line) throw new AppError('LINE_NOT_FOUND', 'That item is no longer in your cart', 404);
      const key = { cartId, skuId: line.skuId, sellerId: line.sellerId };
      await tx.savedItem.upsert({
        where: { cartId_skuId_sellerId: key },
        create: { ...key, productId: line.productId, priceSnapshot: line.priceSnapshot },
        update: { savedAt: new Date() },
      });
      await tx.cartItem.delete({ where: { id: line.id } });
    });
    return cartId;
  }

  async moveSavedToCart(owner: CartOwner, savedId: string, pincode: string): Promise<string> {
    await this.checkPincode(pincode);
    const cartId = await this.requireCart(owner);
    await this.locked(cartId, async (tx) => {
      const saved = await tx.savedItem.findFirst({ where: { id: savedId, cartId } });
      if (!saved) throw new AppError('LINE_NOT_FOUND', 'That item is no longer saved', 404);
      const { offer } = await this.resolveOffer(tx, saved.skuId, saved.sellerId);
      const key = { cartId, skuId: saved.skuId, sellerId: saved.sellerId };
      const existing = await tx.cartItem.findUnique({ where: { cartId_skuId_sellerId: key } });
      if (!existing && (await tx.cartItem.count({ where: { cartId } })) >= this.cfg.CART_MAX_LINES) {
        throw new AppError('CART_FULL', `Your cart can hold up to ${this.cfg.CART_MAX_LINES} different items`, 409);
      }
      this.checkQty(offer, (existing?.qty ?? 0) + 1);
      if (existing) {
        await tx.cartItem.update({ where: { id: existing.id }, data: { qty: existing.qty + 1 } });
      } else {
        await tx.cartItem.create({
          data: { ...key, productId: saved.productId, offerId: offer.id, qty: 1, priceSnapshot: offer.price },
        });
      }
      await tx.savedItem.delete({ where: { id: saved.id } });
    });
    return cartId;
  }

  async removeSaved(owner: CartOwner, savedId: string): Promise<string | null> {
    const cartId = await this.findCartId(owner);
    if (!cartId) return null;
    await this.locked(cartId, (tx) => tx.savedItem.deleteMany({ where: { id: savedId, cartId } }));
    return cartId;
  }

  /**
   * Guest → user merge on sign-in (M3.5). Locks both carts (in id order, so concurrent merges
   * cannot deadlock), sums matching lines capped at live limits, appends new lines up to the line
   * limit and moves overflow to Saved for later. The guest cart is closed as MERGED.
   */
  async mergeGuestCart(guestToken: string, userId: string): Promise<{ merged: number; dropped: number }> {
    const guestId = await this.findCartId({ guestToken });
    if (!guestId) return { merged: 0, dropped: 0 };
    const { cartId: userCartId } = await this.ensureCart({ userId });
    if (userCartId === guestId) return { merged: 0, dropped: 0 };
    return this.prisma.$transaction(async (tx) => {
      const ids = [guestId, userCartId].sort();
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM carts WHERE id IN (${ids[0]}::uuid, ${ids[1]}::uuid)
        ORDER BY id FOR UPDATE`;
      if (locked.some((c) => c.status !== 'ACTIVE') || locked.length !== 2) {
        return { merged: 0, dropped: 0 };
      }
      const [guestItems, userItems, guestSaved] = await Promise.all([
        tx.cartItem.findMany({ where: { cartId: guestId }, orderBy: { addedAt: 'asc' } }),
        tx.cartItem.findMany({ where: { cartId: userCartId } }),
        tx.savedItem.findMany({ where: { cartId: guestId } }),
      ]);
      const offers = await tx.offer.findMany({
        where: { skuId: { in: guestItems.map((i) => i.skuId) } },
        include: { seller: true, sku: { select: { product: { select: { status: true } } } } },
      });
      const offerFor = (l: { skuId: string; sellerId: string }) =>
        offers.find((o) => o.skuId === l.skuId && o.sellerId === l.sellerId);
      const plan = planMerge(
        userItems,
        guestItems,
        (l) => {
          const o = offerFor(l);
          return lineCap(live(o, o?.sku.product.status === 'ACTIVE'), this.cfg.CART_MAX_QTY_PER_ITEM);
        },
        this.limits,
      );
      for (const u of plan.updates) await tx.cartItem.update({ where: { id: u.id }, data: { qty: u.qty } });
      const guestLine = (l: { skuId: string; sellerId: string }) =>
        guestItems.find((g) => g.skuId === l.skuId && g.sellerId === l.sellerId)!;
      if (plan.inserts.length > 0) {
        await tx.cartItem.createMany({
          data: plan.inserts.map((l) => {
            const g = guestLine(l);
            return {
              cartId: userCartId,
              productId: g.productId,
              skuId: g.skuId,
              sellerId: g.sellerId,
              offerId: g.offerId,
              qty: l.qty,
              priceSnapshot: g.priceSnapshot,
              addedAt: g.addedAt,
            };
          }),
        });
      }
      const toSave = [
        ...plan.dropped.map((l) => guestLine(l)),
        ...guestSaved,
      ];
      if (toSave.length > 0) {
        await tx.savedItem.createMany({
          data: toSave.map((s) => ({
            cartId: userCartId,
            productId: s.productId,
            skuId: s.skuId,
            sellerId: s.sellerId,
            priceSnapshot: s.priceSnapshot,
          })),
          skipDuplicates: true,
        });
      }
      await tx.cart.update({ where: { id: guestId }, data: { status: 'MERGED' } });
      await tx.cart.update({ where: { id: userCartId }, data: { version: { increment: 1 } } });
      return { merged: plan.updates.length + plan.inserts.length, dropped: plan.dropped.length };
    });
  }

  // ───────── Views (M3.4) ─────────

  async view(cartId: string | null, pincode: string, now = new Date()): Promise<CartResponse> {
    const cart = cartId
      ? await this.prisma.cart.findUnique({ where: { id: cartId }, include: CART_INCLUDE })
      : null;
    const items = cart?.items ?? [];
    const savedRows = cart?.saved ?? [];
    const productIds = [...new Set([...items, ...savedRows].map((i) => i.productId))];
    const [loaded, pin] = await Promise.all([
      this.products.loadMany(productIds),
      isValidPincode(pincode) ? this.prisma.pincode.findUnique({ where: { pincode } }) : null,
    ]);
    const byId = new Map(loaded.map((p) => [p.row.id, p]));
    const serviceable = isValidPincode(pincode) && pin?.serviceable !== false;

    const priced = items.map((item) => {
      const p = byId.get(item.productId);
      const sku = p?.row.skus.find((s) => s.id === item.skuId);
      const offer = sku?.offers.find((o) => o.sellerId === item.sellerId);
      const r = priceLine(
        {
          qty: item.qty,
          snapshotPrice: Number(item.priceSnapshot),
          offer: live(offer, !!p),
          serviceable,
        },
        this.pricing,
      );
      const deliveryDate =
        offer && serviceable && r.inStock
          ? estimateDelivery({
              fromPin: offer.seller.pincode,
              toPin: pincode,
              fulfilledByShopSphere: offer.fulfilment === 'SHOPSPHERE',
              cutoffHour: offer.seller.cutoffHour,
              pricePaise: Number(offer.price),
              now,
            }).deliveryDate
          : null;
      const line: CartLine = {
        id: item.id,
        productId: item.productId,
        skuId: item.skuId,
        sellerId: item.sellerId,
        slug: p?.row.slug ?? '',
        title: p?.row.title ?? 'This item is no longer available',
        variant: (sku?.attributes ?? {}) as Record<string, string>,
        image: p ? this.image(p, item.skuId) : null,
        sellerName: offer?.seller.name ?? '',
        fulfilment: offer?.fulfilment ?? 'SELLER',
        qty: item.qty,
        maxQty: r.maxQty,
        unitPrice: r.unitPrice,
        mrp: r.mrp,
        snapshotPrice: Number(item.priceSnapshot),
        lineTotal: r.lineTotal,
        inStock: r.inStock,
        available: r.available,
        deliveryDate,
        serviceable,
        priceChange: r.priceChange,
        stockChange: r.stockChange,
        addedAt: item.addedAt.toISOString(),
      };
      return { line, priced: r, serviceable };
    });

    const groups = new Map<string, CartGroup>();
    for (const { line } of priced) {
      const key = `${line.sellerId}|${line.deliveryDate ?? '-'}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          sellerId: line.sellerId,
          sellerName: line.sellerName,
          fulfilment: line.fulfilment,
          deliveryDate: line.deliveryDate,
          lines: [],
        };
        groups.set(key, g);
      }
      g.lines.push(line);
    }

    const saved: SavedItem[] = savedRows.map((s) => {
      const p = byId.get(s.productId);
      const sku = p?.row.skus.find((k) => k.id === s.skuId);
      const offer = sku?.offers.find((o) => o.sellerId === s.sellerId);
      const lo = live(offer, !!p);
      const buyable = lineCap(lo, this.cfg.CART_MAX_QTY_PER_ITEM) > 0;
      return {
        id: s.id,
        productId: s.productId,
        skuId: s.skuId,
        sellerId: s.sellerId,
        slug: p?.row.slug ?? '',
        title: p?.row.title ?? 'This item is no longer available',
        variant: (sku?.attributes ?? {}) as Record<string, string>,
        image: p ? this.image(p, s.skuId) : null,
        price: lo?.active ? lo.price : null,
        mrp: lo?.active ? Math.max(lo.mrp, lo.price) : null,
        inStock: buyable,
        savedAt: s.savedAt.toISOString(),
      };
    });

    return {
      id: cart?.id ?? null,
      pincode,
      version: cart?.version ?? 0,
      groups: [...groups.values()],
      saved,
      summary: summarise(priced, this.pricing),
      limits: this.limits,
    };
  }

  private image(p: LoadedProduct, skuId: string): ImageSet | null {
    const img =
      p.row.images.find((i) => i.skuId === skuId && i.status === 'READY') ??
      p.row.images.find((i) => i.status === 'READY');
    return img ? imageSet(img, this.products.bases) : null;
  }

  /** "Added to cart" drawer suggestions (M3.8): also-viewed, then category best sellers. */
  async addOns(productId: string, cartId: string, limit = 3): Promise<ProductCard[]> {
    const inCart = new Set(
      (await this.prisma.cartItem.findMany({ where: { cartId }, select: { productId: true } })).map(
        (i) => i.productId,
      ),
    );
    inCart.add(productId);
    const ids = (await this.discovery.alsoViewedIds(productId, 12)).filter((id) => !inCart.has(id));
    if (ids.length < limit) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { categoryId: true },
      });
      if (product) {
        const more = await this.prisma.product.findMany({
          where: {
            categoryId: product.categoryId,
            status: 'ACTIVE',
            id: { notIn: [...inCart, ...ids] },
          },
          orderBy: { salesRank: 'asc' },
          take: limit * 2,
          select: { id: true },
        });
        ids.push(...more.map((m) => m.id));
      }
    }
    return (await this.products.cards(ids)).filter((c) => c.inStock).slice(0, limit);
  }
}
