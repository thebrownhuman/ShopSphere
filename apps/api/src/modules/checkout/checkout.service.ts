import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type CheckoutSession as SessionRow, type Coupon } from '@prisma/client';
import type {
  CheckoutAddress,
  CheckoutIssue,
  CheckoutLine,
  CheckoutLineIssue,
  CheckoutSession,
  CreateCheckoutRequest,
  DeliveryChoice,
  LineTax,
  PaymentMethodChoice,
  PaymentOption,
  PaymentProviderName,
  PlaceOrderResponse,
  UpdateCheckoutRequest,
} from '@shopsphere/types';
import { CategoryTreeService } from '../catalog/category-tree.service';
import { imageSet } from '../catalog/media';
import { ProductLoader, rankOffers } from '../catalog/product-loader';
import type { CouponLine } from '../coupon/coupon-engine';
import { CouponService } from '../coupon/coupon.service';
import { InventoryService } from '../inventory/inventory.service';
import { LedgerService } from '../ledger/ledger.service';
import { PAY_WINDOW_MS, OrderService, type NewOrder } from '../order/order.service';
import { PromotionsService } from '../promotions/promotions.service';
import type { BankOfferPick } from '../promotions/bank-offer';
import { ProviderRegistry } from '../payment/providers/provider.registry';
import { resolveGstBp } from '../pricing/pricing';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import { lineTax, sumTax } from '../tax/gst';
import { COD_FEE_PAISE, codVerdict, riskScore } from './cod';
import { splitShipments, type SplitLine } from './shipments';

/** Session lifetime after the last change (PRD §8 edge cases). */
export const SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PIN = '560001';
const MAX_LINES = 50;

interface SessionItem {
  skuId: string;
  sellerId: string;
  qty: number;
  /** Unit price (paise) when the item entered checkout (cart snapshot or Buy Now). */
  priceSnapshot: number;
}

type OfferFull = Prisma.OfferGetPayload<{
  include: { seller: true; sku: { include: { product: { include: { images: true } } } } };
}>;

interface QuoteLine extends SplitLine {
  item: SessionItem;
  offer: OfferFull | null;
  view: CheckoutLine;
  categoryIds: string[];
  sellerState: string;
  blocking: boolean;
  /** M6.6 lightning deal priced into this line; claimed at place-order. */
  dealId?: string;
}

export interface Quote {
  view: CheckoutSession;
  lines: QuoteLine[];
  shipments: ReturnType<typeof splitShipments<QuoteLine>>;
  coupon: Coupon | null;
  couponLines: CouponLine[];
  address: CheckoutAddress | null;
  bankOffer: BankOfferPick | null;
}

const n = (v: bigint | number) => Number(v);
const BLOCKING: CheckoutLineIssue[] = ['OUT_OF_STOCK', 'LIMITED', 'UNAVAILABLE', 'UNSERVICEABLE'];

const sessionNotFound = () =>
  new AppError('CHECKOUT_NOT_FOUND', 'Checkout not found', HttpStatus.NOT_FOUND);

function variantLabel(attrs: unknown): string | null {
  const v = Object.values((attrs ?? {}) as Record<string, string>).filter(Boolean);
  return v.length ? v.join(', ') : null;
}

/**
 * Checkout (M4.3–M4.9). A session holds what the shopper is buying (cart snapshot or one Buy Now
 * item) plus their choices; every read re-prices it from live data (quote()), so prices, stock,
 * coupon eligibility and serviceability are always current. place-order re-validates everything
 * again under row locks and creates the order in one transaction.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductLoader,
    private readonly categories: CategoryTreeService,
    private readonly coupons: CouponService,
    private readonly ledger: LedgerService,
    private readonly inventory: InventoryService,
    private readonly orders: OrderService,
    @Inject(ProviderRegistry) private readonly providers: ProviderRegistry,
    private readonly promotions: PromotionsService,
  ) {}

  // ───────── Sessions ─────────

  private preferredProvider(): PaymentProviderName {
    const available = this.providers.available();
    return available.includes('razorpay') ? 'razorpay' : 'bank';
  }

  async create(userId: string, input: CreateCheckoutRequest): Promise<CheckoutSession> {
    let items: SessionItem[];
    let cartId: string | null = null;
    if (input.source === 'CART') {
      const cart = await this.prisma.cart.findFirst({
        where: { userId, status: 'ACTIVE' },
        include: { items: { orderBy: { addedAt: 'asc' } } },
      });
      if (!cart || cart.items.length === 0) {
        throw new AppError(
          'CHECKOUT_INVALID',
          'Your cart is empty',
          HttpStatus.UNPROCESSABLE_ENTITY,
          {
            issues: [{ code: 'EMPTY', message: 'Your cart is empty' }],
          },
        );
      }
      cartId = cart.id;
      items = cart.items.slice(0, MAX_LINES).map((i) => ({
        skuId: i.skuId,
        sellerId: i.sellerId,
        qty: i.qty,
        priceSnapshot: n(i.priceSnapshot),
      }));
    } else {
      const sku = await this.prisma.sku.findUnique({
        where: { id: input.skuId },
        include: { product: { select: { status: true } }, offers: { include: { seller: true } } },
      });
      const offer = sku
        ? input.sellerId
          ? sku.offers.find((o) => o.sellerId === input.sellerId)
          : rankOffers(sku.offers as never)[0]
        : undefined;
      if (!sku || sku.product.status !== 'ACTIVE' || !offer || offer.status !== 'ACTIVE') {
        throw new AppError(
          'OFFER_UNAVAILABLE',
          'This item is not available right now',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (input.qty > offer.maxPerOrder) {
        throw new AppError(
          'QTY_LIMIT',
          `You can buy only ${offer.maxPerOrder} of this item`,
          HttpStatus.CONFLICT,
          {
            limit: offer.maxPerOrder,
          },
        );
      }
      items = [
        { skuId: sku.id, sellerId: offer.sellerId, qty: input.qty, priceSnapshot: n(offer.price) },
      ];
    }
    const address = input.addressId
      ? await this.requireAddress(userId, input.addressId)
      : await this.prisma.address.findFirst({
          where: { userId, deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        });
    const session = await this.prisma.checkoutSession.create({
      data: {
        userId,
        source: input.source,
        cartId,
        items: items as unknown as Prisma.InputJsonValue,
        addressId: address?.id ?? null,
        paymentMethod: { type: 'ONLINE', provider: this.preferredProvider() },
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return this.present(session);
  }

  private async requireAddress(userId: string, addressId: string) {
    const a = /^[0-9a-f-]{36}$/i.test(addressId)
      ? await this.prisma.address.findFirst({ where: { id: addressId, userId, deletedAt: null } })
      : null;
    if (!a) throw new AppError('ADDRESS_NOT_FOUND', 'Address not found', HttpStatus.NOT_FOUND);
    return a;
  }

  private async load(userId: string, id: string, db: Tx = this.prisma): Promise<SessionRow> {
    const s = /^[0-9a-f-]{36}$/i.test(id)
      ? await db.checkoutSession.findUnique({ where: { id } })
      : null;
    if (!s || s.userId !== userId) throw sessionNotFound();
    return s;
  }

  private assertOpen(s: SessionRow, now = new Date()): void {
    if (s.status === 'OPEN' && s.expiresAt <= now) {
      throw new AppError(
        'CHECKOUT_EXPIRED',
        'Your checkout session timed out. Please start again.',
        HttpStatus.GONE,
      );
    }
    if (s.status === 'EXPIRED') {
      throw new AppError(
        'CHECKOUT_EXPIRED',
        'Your checkout session timed out. Please start again.',
        HttpStatus.GONE,
      );
    }
  }

  async get(userId: string, id: string): Promise<CheckoutSession> {
    return this.present(await this.load(userId, id));
  }

  async update(userId: string, id: string, input: UpdateCheckoutRequest): Promise<CheckoutSession> {
    const s = await this.load(userId, id);
    if (s.status !== 'OPEN') {
      throw new AppError(
        'CHECKOUT_INVALID',
        'This checkout was already placed',
        HttpStatus.CONFLICT,
      );
    }
    this.assertOpen(s);
    const data: Prisma.CheckoutSessionUpdateInput = {
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    };
    if (input.addressId !== undefined)
      data.addressId = (await this.requireAddress(userId, input.addressId)).id;
    if (input.deliveryOptions !== undefined) {
      const merged = new Map(
        (s.deliveryChoices as unknown as DeliveryChoice[]).map((c) => [c.shipmentKey, c]),
      );
      for (const c of input.deliveryOptions) merged.set(c.shipmentKey, c);
      data.deliveryChoices = [...merged.values()] as unknown as Prisma.InputJsonValue;
    }
    if (input.paymentMethod !== undefined) {
      if (
        input.paymentMethod?.type === 'ONLINE' &&
        !this.providers.available().includes(input.paymentMethod.provider)
      ) {
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          `Payment provider "${input.paymentMethod.provider}" is not configured`,
        );
      }
      data.paymentMethod =
        input.paymentMethod === null
          ? Prisma.DbNull
          : (input.paymentMethod as Prisma.InputJsonValue);
    }
    if (input.couponCode !== undefined)
      data.couponCode = input.couponCode?.trim().toUpperCase() || null;
    if (input.useStoreBalance !== undefined) data.useStoreBalance = input.useStoreBalance;
    const updated = await this.prisma.checkoutSession.update({ where: { id: s.id }, data });
    return this.present(updated, { dropBadCoupon: input.couponCode !== undefined });
  }

  /** Quotes, remembers the shown total, and drops a just-entered coupon that does not apply. */
  private async present(
    s: SessionRow,
    opts: { dropBadCoupon?: boolean } = {},
  ): Promise<CheckoutSession> {
    const q = await this.quote(s);
    const data: Prisma.CheckoutSessionUpdateInput = {};
    if (s.status === 'OPEN') data.quotedTotal = BigInt(q.view.totals.totalPaise);
    if (q.view.couponError && opts.dropBadCoupon) data.couponCode = null;
    if (Object.keys(data).length)
      await this.prisma.checkoutSession.update({ where: { id: s.id }, data });
    return q.view;
  }

  // ───────── Quote ─────────

  async quote(s: SessionRow, now = new Date()): Promise<Quote> {
    const items = s.items as unknown as SessionItem[];
    const addressRow = s.addressId
      ? await this.prisma.address.findFirst({
          where: { id: s.addressId, userId: s.userId, deletedAt: null },
        })
      : null;
    const address: CheckoutAddress | null = addressRow
      ? {
          id: addressRow.id,
          name: addressRow.name,
          phone: addressRow.phone,
          line1: addressRow.line1,
          line2: addressRow.line2,
          landmark: addressRow.landmark,
          city: addressRow.city,
          state: addressRow.state,
          pincode: addressRow.pincode,
        }
      : null;
    const pin = address?.pincode ?? DEFAULT_PIN;
    const pinRow = await this.prisma.pincode.findUnique({ where: { pincode: pin } });
    const serviceable = pinRow?.serviceable !== false;

    const offers: OfferFull[] = items.length
      ? await this.prisma.offer.findMany({
          where: { OR: items.map((i) => ({ skuId: i.skuId, sellerId: i.sellerId })) },
          include: {
            seller: true,
            sku: {
              include: { product: { include: { images: { orderBy: { position: 'asc' } } } } },
            },
          },
        })
      : [];
    const byKey = new Map(offers.map((o) => [`${o.skuId}:${o.sellerId}`, o]));

    const lines: QuoteLine[] = [];
    for (const item of items) {
      const offer = byKey.get(`${item.skuId}:${item.sellerId}`) ?? null;
      const product = offer?.sku.product;
      const chain = product ? await this.categories.chain(product.categoryId) : [];
      const gstBp = resolveGstBp(chain);
      const active =
        !!offer &&
        offer.status === 'ACTIVE' &&
        offer.seller.status === 'ACTIVE' &&
        product?.status === 'ACTIVE';
      const available = offer ? Math.max(0, offer.stockQty - offer.reservedQty) : 0;
      const cap = offer ? Math.min(available, offer.maxPerOrder) : 0;
      let issue: CheckoutLineIssue | null = null;
      if (!active) issue = 'UNAVAILABLE';
      else if (available <= 0) issue = 'OUT_OF_STOCK';
      else if (item.qty > cap) issue = 'LIMITED';
      else if (!serviceable) issue = 'UNSERVICEABLE';
      else if (n(offer!.price) !== item.priceSnapshot) issue = 'PRICE_CHANGED';
      const unit = active ? n(offer!.price) : 0;
      const img =
        product?.images.find((i) => i.skuId === item.skuId && i.status === 'READY') ??
        product?.images.find((i) => i.status === 'READY');
      const key = `${item.skuId}:${item.sellerId}`;
      lines.push({
        key,
        item,
        offer,
        categoryIds: chain.map((c) => c.id),
        sellerState: offer?.seller.state ?? '',
        blocking: issue !== null && BLOCKING.includes(issue),
        sellerId: item.sellerId,
        sellerName: offer?.seller.name ?? 'Seller',
        sellerPincode: offer?.seller.pincode ?? DEFAULT_PIN,
        cutoffHour: offer?.seller.cutoffHour ?? 14,
        fulfilledByShopSphere: offer?.fulfilment === 'SHOPSPHERE',
        categoryPath: chain[0]?.path ?? '',
        lineTotalPaise: unit * item.qty,
        view: {
          productId: product?.id ?? '',
          skuId: item.skuId,
          offerId: offer?.id ?? '',
          sellerId: item.sellerId,
          slug: product?.slug ?? '',
          title: product?.title ?? 'Unavailable item',
          variant: variantLabel(offer?.sku.attributes),
          imageUrl: img ? (imageSet(img, this.products.bases)?.small ?? null) : null,
          qty: item.qty,
          unitPricePaise: unit,
          mrpPaise: offer ? Math.max(n(offer.mrp), unit) : 0,
          lineTotalPaise: unit * item.qty,
          discountPaise: 0,
          tax: { rateBp: gstBp, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 },
          available,
          issue,
          previousUnitPricePaise: issue === 'PRICE_CHANGED' ? item.priceSnapshot : null,
        },
      });
    }

    // Lightning deals (M6.6): live deal price replaces the offer price while units remain.
    const deals = await this.promotions.liveDealsForOffers(
      lines.filter((l) => l.offer && !l.blocking).map((l) => l.offer!.id),
      now,
    );
    for (const l of lines) {
      const deal = l.offer && !l.blocking ? deals.get(l.offer.id) : undefined;
      if (!deal || deal.quantityCap - deal.claimedQty < l.item.qty) continue;
      const unit = n(deal.dealPricePaise);
      l.dealId = deal.id;
      l.lineTotalPaise = unit * l.item.qty;
      l.view.unitPricePaise = unit;
      l.view.lineTotalPaise = unit * l.item.qty;
    }

    // Coupon (M4.6) on the live lines.
    const couponLines: CouponLine[] = lines
      .filter((l) => !l.blocking)
      .map((l) => ({
        key: l.key,
        sellerId: l.sellerId,
        categoryIds: l.categoryIds,
        lineTotalPaise: l.lineTotalPaise,
      }));
    let coupon: Coupon | null = null;
    let couponDiscount = 0;
    let couponError: CheckoutSession['couponError'] = null;
    if (s.couponCode) {
      const ev = await this.coupons.evaluate(s.couponCode, s.userId, couponLines, now);
      if (ev.result.ok) {
        coupon = ev.coupon;
        couponDiscount = ev.result.discountPaise;
        for (const l of lines) l.view.discountPaise = ev.result.allocation.get(l.key) ?? 0;
      } else {
        couponError = { code: ev.result.code, message: ev.result.message };
      }
    }

    // GST (M4.8) on what is actually paid for each line.
    const shipTo = address?.state;
    for (const l of lines) {
      const amount = l.lineTotalPaise - l.view.discountPaise;
      l.view.tax = lineTax(amount, l.view.tax.rateBp, l.sellerState, shipTo ?? l.sellerState);
    }

    // Shipments (M4.5) and delivery charges.
    const shipments = splitShipments(
      lines,
      pin,
      s.deliveryChoices as unknown as DeliveryChoice[],
      now,
    );

    const itemsPaise = lines.reduce((a, l) => a + l.lineTotalPaise, 0);
    const mrpPaise = lines.reduce((a, l) => a + l.view.mrpPaise * l.item.qty, 0);
    const deliveryPaise = shipments.reduce((a, x) => a + x.deliveryFeePaise, 0);
    const method = (s.paymentMethod as PaymentMethodChoice | null) ?? null;
    const codFee = method?.type === 'COD' ? COD_FEE_PAISE : 0;
    // Bank offer (M6.6): only when paying online through its provider (ShopSphere Bank).
    const bankOffer = s.useStoreBalance
      ? null
      : await this.promotions.bankOfferFor(
          method?.type === 'ONLINE' ? method : null,
          itemsPaise - couponDiscount,
          now,
        );
    const bankDiscount = bankOffer?.discountPaise ?? 0;
    const totalPaise = itemsPaise + deliveryPaise - couponDiscount - bankDiscount + codFee;
    const balance = n(await this.ledger.balance(s.userId));
    const storeBalancePaise = s.useStoreBalance ? Math.min(balance, totalPaise) : 0;
    const payablePaise = totalPaise - storeBalancePaise;

    // Payment options: gateways, COD (M4.19), saved methods stub (M4.20).
    const [priorOrders, ordersLastHour] = await Promise.all([
      this.prisma.order.count({ where: { userId: s.userId } }),
      this.prisma.order.count({
        where: { userId: s.userId, placedAt: { gt: new Date(now.getTime() - 3_600_000) } },
      }),
    ]);
    const codPayable = payablePaise + (codFee ? 0 : COD_FEE_PAISE);
    const cod = codVerdict({
      payablePaise: codPayable,
      pincode: pin,
      pincodeServiceable: serviceable,
      risk: riskScore({ priorOrders, ordersLastHour, totalPaise }),
    });
    const available = this.providers.available();
    const paymentOptions: PaymentOption[] = [
      ...(['razorpay', 'bank'] as const).map((provider) => ({
        method: { type: 'ONLINE', provider } as PaymentMethodChoice,
        label:
          provider === 'razorpay'
            ? 'UPI, cards, net banking, wallets (Razorpay)'
            : 'ShopSphere Bank (cards, net banking, UPI)',
        available: available.includes(provider),
        reason: available.includes(provider) ? null : 'PROVIDER_DISABLED',
      })),
      {
        method: { type: 'COD' },
        label: 'Cash on Delivery',
        available: cod.available,
        reason: cod.reason,
      },
    ];

    const issues: CheckoutIssue[] = [];
    if (lines.length === 0) issues.push({ code: 'EMPTY', message: 'Nothing to check out' });
    if (!address) issues.push({ code: 'ADDRESS_REQUIRED', message: 'Choose a delivery address' });
    for (const l of lines.filter((x) => x.blocking)) {
      issues.push({
        code: 'LINE_ISSUE',
        message: `${l.view.title}: ${l.view.issue}`,
        skuId: l.item.skuId,
      });
    }
    if (payablePaise > 0) {
      if (!method)
        issues.push({ code: 'PAYMENT_METHOD_REQUIRED', message: 'Choose a payment method' });
      else if (method.type === 'COD' && !cod.available) {
        issues.push({
          code: 'PAYMENT_METHOD_UNAVAILABLE',
          message: 'Cash on Delivery is not available for this order',
        });
      } else if (method.type === 'ONLINE' && !available.includes(method.provider)) {
        issues.push({
          code: 'PAYMENT_METHOD_UNAVAILABLE',
          message: 'This payment option is not available',
        });
      }
    }

    const tax = sumTax(lines.map((l) => l.view.tax));
    const view: CheckoutSession = {
      id: s.id,
      status:
        s.status === 'OPEN' && s.expiresAt <= now
          ? 'EXPIRED'
          : (s.status as CheckoutSession['status']),
      source: s.source as CheckoutSession['source'],
      expiresAt: s.expiresAt.toISOString(),
      address,
      serviceable,
      shipments: shipments.map((x) => ({
        key: x.key,
        sellerId: x.sellerId,
        sellerName: x.sellerName,
        fulfilledByShopSphere: x.fulfilledByShopSphere,
        lines: x.lines.map((l) => l.view),
        options: x.options,
        selected: x.selected,
        deliveryDate: x.deliveryDate,
        deliveryFeePaise: x.deliveryFeePaise,
        itemsPaise: x.itemsPaise,
      })),
      coupon: coupon
        ? { code: coupon.code, description: coupon.description, discountPaise: couponDiscount }
        : null,
      couponError,
      bankOffer,
      storeBalance: { availablePaise: balance, applied: storeBalancePaise > 0 },
      paymentMethod: method,
      paymentOptions,
      savedMethods: [],
      totals: {
        itemsPaise,
        mrpPaise,
        deliveryPaise,
        couponDiscountPaise: couponDiscount,
        bankOfferDiscountPaise: bankDiscount,
        codFeePaise: codFee,
        totalPaise,
        storeBalancePaise,
        payablePaise,
        tax,
        savingsPaise: mrpPaise - itemsPaise + couponDiscount + bankDiscount,
      },
      issues,
      orderId: s.orderId,
    };
    return { view, lines, shipments, coupon, couponLines, address, bankOffer };
  }

  // ───────── Place order (M4.9) ─────────

  async placeOrder(
    userId: string,
    id: string,
    idempotencyKey: string,
    expectedTotalPaise: number,
  ): Promise<PlaceOrderResponse> {
    // Same key replayed (double click, retry after timeout): answer with the order already made.
    const prior = await this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (prior) return this.placedResponse(prior.id);

    const s0 = await this.load(userId, id);
    if (s0.status === 'PLACED' && s0.orderId) return this.placedResponse(s0.orderId);
    this.assertOpen(s0);
    const q = await this.quote(s0);
    if (q.view.issues.length > 0) {
      throw new AppError(
        'CHECKOUT_INVALID',
        q.view.issues[0].message,
        HttpStatus.UNPROCESSABLE_ENTITY,
        {
          issues: q.view.issues,
          session: q.view,
        },
      );
    }
    if (q.view.totals.totalPaise !== expectedTotalPaise) {
      await this.prisma.checkoutSession.update({
        where: { id: s0.id },
        data: { quotedTotal: BigInt(q.view.totals.totalPaise) },
      });
      throw new AppError(
        'PRICE_CHANGED',
        'Your order total changed. Please review and confirm.',
        HttpStatus.CONFLICT,
        {
          previousTotalPaise: expectedTotalPaise,
          totalPaise: q.view.totals.totalPaise,
          session: q.view,
        },
      );
    }

    let orderId: string;
    try {
      orderId = await this.prisma.$transaction(
        async (tx) => {
          // Two tabs on one session serialise here; the loser sees PLACED and replays.
          await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE id = ${s0.id}::uuid FOR UPDATE`;
          const s = await tx.checkoutSession.findUniqueOrThrow({ where: { id: s0.id } });
          if (s.status === 'PLACED' && s.orderId) return s.orderId;
          if (choices(s) !== choices(s0)) {
            throw new AppError(
              'CHECKOUT_CHANGED',
              'Your checkout changed. Please review and confirm.',
              HttpStatus.CONFLICT,
            );
          }
          return this.createOrder(tx, s, q, idempotencyKey);
        },
        { timeout: 20_000, maxWait: 20_000 },
      );
    } catch (err) {
      // Lost a race on the idempotency key: the other request created the order.
      if ((err as { code?: string }).code === 'P2002') {
        const again = await this.prisma.order.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
        });
        if (again) return this.placedResponse(again.id);
      }
      throw err;
    }
    return this.placedResponse(orderId);
  }

  private async createOrder(
    tx: Tx,
    s: SessionRow,
    q: Quote,
    idempotencyKey: string,
  ): Promise<string> {
    const t = q.view.totals;
    const method = q.view.paymentMethod;
    const paymentMethod =
      t.payablePaise === 0 ? 'STORE_BALANCE' : method?.type === 'COD' ? 'COD' : 'ONLINE';
    const address = q.address!;
    const input: NewOrder = {
      userId: s.userId,
      checkoutId: s.id,
      idempotencyKey,
      paymentMethod,
      paymentProvider: method?.type === 'ONLINE' ? method.provider : null,
      totals: {
        itemsPaise: t.itemsPaise,
        mrpPaise: t.mrpPaise,
        deliveryPaise: t.deliveryPaise,
        // Orders keep one discount column; the bank-offer share is in bank_offer_redemptions.
        couponDiscountPaise: t.couponDiscountPaise + (t.bankOfferDiscountPaise ?? 0),
        codFeePaise: t.codFeePaise,
        totalPaise: t.totalPaise,
        storeBalancePaise: t.storeBalancePaise,
        payablePaise: t.payablePaise,
        cgstPaise: t.tax.cgstPaise,
        sgstPaise: t.tax.sgstPaise,
        igstPaise: t.tax.igstPaise,
      },
      coupon: q.coupon ? { id: q.coupon.id, code: q.coupon.code } : null,
      address,
      source: s.source,
      cartId: s.cartId,
      shipments: q.shipments.map((x) => ({
        sellerId: x.sellerId,
        sellerName: x.sellerName,
        sellerState: x.lines[0].sellerState,
        fulfilledByShopSphere: x.fulfilledByShopSphere,
        deliveryOption: x.selected.type,
        deliveryFeePaise: x.deliveryFeePaise,
        promisedDate: x.deliveryDate,
        items: x.lines.map((l) => toItem(l.view, l.view.tax)),
      })),
    };
    const payBy = paymentMethod === 'ONLINE' ? new Date(Date.now() + PAY_WINDOW_MS) : null;
    const order = await this.orders.create(tx, input, payBy);
    await this.inventory.reserveOrThrow(
      tx,
      order.id,
      q.lines.map((l) => ({
        offerId: l.offer!.id,
        skuId: l.item.skuId,
        qty: l.item.qty,
        // Deal lines are priced below the offer; the offer price is still what must not move
        // (the deal itself is re-checked by the claim below).
        unitPricePaise: l.dealId ? n(l.offer!.price) : l.view.unitPricePaise,
      })),
      payBy ?? new Date(Date.now() + PAY_WINDOW_MS),
    );
    if (q.coupon) {
      await this.coupons.hold(
        tx,
        q.coupon.id,
        s.userId,
        order.id,
        q.couponLines,
        t.couponDiscountPaise,
      );
    }
    for (const l of q.lines) {
      if (l.dealId) await this.promotions.claim(tx, order.id, l.dealId, l.item.qty);
    }
    if (q.bankOffer) await this.promotions.recordBankOffer(tx, order.id, q.bankOffer);
    if (t.storeBalancePaise > 0) {
      await this.ledger.debitForOrder(tx, s.userId, order.id, BigInt(t.storeBalancePaise));
    }
    // COD and fully balance-paid orders skip the gateway and confirm now (PRD §8 step 4).
    if (paymentMethod !== 'ONLINE')
      await this.orders.confirm(tx, order, { lateCapture: false, actor: 'customer' });
    await tx.checkoutSession.update({
      where: { id: s.id },
      data: { status: 'PLACED', orderId: order.id },
    });
    return order.id;
  }

  private async placedResponse(orderId: string): Promise<PlaceOrderResponse> {
    const o = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const pay = o.status === 'PENDING_PAYMENT' && o.paymentMethod === 'ONLINE';
    return {
      orderId: o.id,
      orderNumber: o.number,
      status: o.status as PlaceOrderResponse['status'],
      totalPaise: n(o.totalPaise),
      payablePaise: n(o.payablePaise),
      next: pay
        ? {
            type: 'PAY',
            amountPaise: n(o.payablePaise),
            providers: this.providers.available(),
            preferredProvider:
              (o.paymentProvider as PaymentProviderName | null) ?? this.preferredProvider(),
            payBy: o.payBy!.toISOString(),
          }
        : { type: 'CONFIRMED' },
    };
  }
}

/** What the shopper chose; a change between quote and lock means the quote is stale. */
function choices(s: SessionRow): string {
  return JSON.stringify([
    s.items,
    s.addressId,
    s.deliveryChoices,
    s.paymentMethod,
    s.couponCode,
    s.useStoreBalance,
  ]);
}

function toItem(v: CheckoutLine, tax: LineTax) {
  return {
    productId: v.productId,
    skuId: v.skuId,
    offerId: v.offerId,
    sellerId: v.sellerId,
    slug: v.slug,
    title: v.title,
    variant: v.variant,
    imageUrl: v.imageUrl,
    qty: v.qty,
    unitPricePaise: v.unitPricePaise,
    mrpPaise: v.mrpPaise,
    lineTotalPaise: v.lineTotalPaise,
    discountPaise: v.discountPaise,
    gstRateBp: tax.rateBp,
    taxablePaise: tax.taxablePaise,
    cgstPaise: tax.cgstPaise,
    sgstPaise: tax.sgstPaise,
    igstPaise: tax.igstPaise,
  };
}
