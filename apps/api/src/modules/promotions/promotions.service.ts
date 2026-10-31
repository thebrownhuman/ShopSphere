import { HttpStatus, Injectable } from '@nestjs/common';
import type { BankOffer, Coupon, LightningDeal } from '@prisma/client';
import type {
  AdminCoupon,
  BankOfferInput,
  BankOfferView,
  CouponInput,
  DealOfferOption,
  LightningDealInput,
  LightningDealView,
} from '@shopsphere/types';
import { normaliseCouponCode } from '../coupon/coupon-engine';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import { pickBankOffer, type BankOfferPick, type PaymentChoice } from './bank-offer';

const n = (v: bigint | number) => Number(v);

export function dealView(d: LightningDeal): LightningDealView {
  return {
    id: d.id,
    offerId: d.offerId,
    skuId: d.skuId,
    productId: d.productId,
    title: d.title,
    dealPricePaise: n(d.dealPricePaise),
    quantityCap: d.quantityCap,
    claimedQty: d.claimedQty,
    claimedPercent: Math.min(100, Math.floor((d.claimedQty * 100) / d.quantityCap)),
    startsAt: d.startsAt.toISOString(),
    endsAt: d.endsAt.toISOString(),
    active: d.active,
  };
}

function bankOfferView(o: BankOffer): BankOfferView {
  return {
    id: o.id,
    title: o.title,
    provider: 'bank',
    percentBp: o.percentBp,
    maxDiscountPaise: o.maxDiscountPaise === null ? null : n(o.maxDiscountPaise),
    minOrderPaise: n(o.minOrderPaise),
    startsAt: o.startsAt.toISOString(),
    endsAt: o.endsAt.toISOString(),
    active: o.active,
  };
}

function couponView(c: Coupon): AdminCoupon {
  return {
    id: c.id,
    code: c.code,
    description: c.description,
    type: c.type === 'PERCENT' ? 'PERCENT' : 'FLAT',
    value: n(c.value),
    minOrderPaise: n(c.minOrderPaise),
    maxDiscountPaise: c.maxDiscountPaise === null ? null : n(c.maxDiscountPaise),
    perUserLimit: c.perUserLimit,
    totalLimit: c.totalLimit,
    usedCount: c.usedCount,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    active: c.active,
  };
}

const notFound = (what: string) =>
  new AppError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);

/**
 * Promotions (M6.6): coupons (rows for the existing coupon engine), lightning deals and bank
 * offers. Checkout and home read live deals / offers through the methods below.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Coupons ──

  async listCoupons(): Promise<AdminCoupon[]> {
    const rows = await this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map(couponView);
  }

  async saveCoupon(input: CouponInput, id?: string): Promise<AdminCoupon> {
    const data = {
      code: normaliseCouponCode(input.code),
      description: input.description,
      type: input.type,
      value: BigInt(input.value),
      minOrderPaise: BigInt(input.minOrderPaise),
      maxDiscountPaise: input.maxDiscountPaise === null ? null : BigInt(input.maxDiscountPaise),
      perUserLimit: input.perUserLimit,
      totalLimit: input.totalLimit,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      active: input.active,
    };
    const clash = await this.prisma.coupon.findUnique({ where: { code: data.code } });
    if (clash && clash.id !== id)
      throw new AppError('COUPON_EXISTS', 'A coupon with this code exists', HttpStatus.CONFLICT);
    if (id) {
      if (!(await this.prisma.coupon.findUnique({ where: { id } }))) throw notFound('Coupon');
      return couponView(await this.prisma.coupon.update({ where: { id }, data }));
    }
    return couponView(await this.prisma.coupon.create({ data }));
  }

  // ── Lightning deals ──

  async listDeals(): Promise<LightningDealView[]> {
    const rows = await this.prisma.lightningDeal.findMany({
      orderBy: { startsAt: 'desc' },
      take: 500,
    });
    return rows.map(dealView);
  }

  /** Offer picker for the deal builder: live offers whose product title matches `q`. */
  async searchOffers(q: string): Promise<DealOfferOption[]> {
    const rows = await this.prisma.offer.findMany({
      where: {
        status: 'ACTIVE',
        sku: { product: { title: { contains: q.trim(), mode: 'insensitive' } } },
      },
      include: { seller: true, sku: { include: { product: true } } },
      orderBy: { price: 'asc' },
      take: 20,
    });
    return rows.map((o) => ({
      offerId: o.id,
      productId: o.sku.productId,
      skuId: o.skuId,
      sellerId: o.sellerId,
      title: o.sku.product.title,
      sellerName: o.seller.name,
      pricePaise: n(o.price),
      mrpPaise: n(o.mrp),
      availableQty: Math.max(0, o.stockQty - o.reservedQty),
    }));
  }

  async createDeal(input: LightningDealInput): Promise<LightningDealView> {
    const offer = await this.prisma.offer.findUnique({
      where: { id: input.offerId },
      include: { sku: { include: { product: true } } },
    });
    if (!offer) throw notFound('Offer');
    if (input.dealPricePaise >= n(offer.price)) {
      throw new AppError(
        'DEAL_PRICE_INVALID',
        'Deal price must be below the current selling price',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const row = await this.prisma.lightningDeal.create({
      data: {
        offerId: offer.id,
        skuId: offer.skuId,
        productId: offer.sku.productId,
        title: input.title?.trim() || offer.sku.product.title,
        dealPricePaise: BigInt(input.dealPricePaise),
        quantityCap: input.quantityCap,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        active: input.active ?? true,
      },
    });
    return dealView(row);
  }

  async updateDeal(
    id: string,
    patch: Partial<Pick<LightningDealInput, 'active' | 'endsAt' | 'quantityCap'>>,
  ): Promise<LightningDealView> {
    const row = await this.prisma.lightningDeal.findUnique({ where: { id } });
    if (!row) throw notFound('Deal');
    if (patch.quantityCap !== undefined && patch.quantityCap < row.claimedQty) {
      throw new AppError(
        'DEAL_CAP_BELOW_CLAIMED',
        `Already ${row.claimedQty} claimed`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return dealView(
      await this.prisma.lightningDeal.update({
        where: { id },
        data: {
          active: patch.active,
          quantityCap: patch.quantityCap,
          endsAt: patch.endsAt ? new Date(patch.endsAt) : undefined,
        },
      }),
    );
  }

  /** Live deals (in window, active, not sold out), soonest-ending first. */
  async liveDeals(now = new Date(), limit = 24): Promise<LightningDeal[]> {
    const rows = await this.prisma.lightningDeal.findMany({
      where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { endsAt: 'asc' },
      take: limit * 2,
    });
    return rows.filter((d) => d.claimedQty < d.quantityCap).slice(0, limit);
  }

  /** Cheapest live, not-sold-out deal per offer id (checkout pricing). */
  async liveDealsForOffers(
    offerIds: string[],
    now = new Date(),
  ): Promise<Map<string, LightningDeal>> {
    if (!offerIds.length) return new Map();
    const rows = await this.prisma.lightningDeal.findMany({
      where: {
        offerId: { in: offerIds },
        active: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { dealPricePaise: 'asc' },
    });
    const out = new Map<string, LightningDeal>();
    for (const d of rows) {
      if (d.claimedQty < d.quantityCap && !out.has(d.offerId)) out.set(d.offerId, d);
    }
    return out;
  }

  /**
   * Takes `qty` units of a deal for an order. One conditional UPDATE keeps
   * claimed_qty <= quantity_cap under any concurrency (the row lock serialises writers).
   */
  async claim(
    tx: Tx,
    orderId: string,
    dealId: string,
    qty: number,
    now = new Date(),
  ): Promise<void> {
    const updated = await tx.$executeRaw`
      UPDATE lightning_deals SET claimed_qty = claimed_qty + ${qty}, updated_at = now()
      WHERE id = ${dealId}::uuid AND active AND starts_at <= ${now} AND ends_at > ${now}
        AND claimed_qty + ${qty} <= quantity_cap`;
    if (updated === 0) {
      throw new AppError(
        'DEAL_SOLD_OUT',
        'This lightning deal has just been fully claimed',
        HttpStatus.CONFLICT,
      );
    }
    await tx.dealClaim.create({ data: { orderId, dealId, qty } });
  }

  // ── Bank offers ──

  async listBankOffers(): Promise<BankOfferView[]> {
    const rows = await this.prisma.bankOffer.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(bankOfferView);
  }

  async saveBankOffer(input: BankOfferInput, id?: string): Promise<BankOfferView> {
    const data = {
      title: input.title,
      provider: 'bank',
      percentBp: input.percentBp,
      maxDiscountPaise: input.maxDiscountPaise === null ? null : BigInt(input.maxDiscountPaise),
      minOrderPaise: BigInt(input.minOrderPaise),
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      active: input.active,
    };
    if (id) {
      if (!(await this.prisma.bankOffer.findUnique({ where: { id } })))
        throw notFound('Bank offer');
      return bankOfferView(await this.prisma.bankOffer.update({ where: { id }, data }));
    }
    return bankOfferView(await this.prisma.bankOffer.create({ data }));
  }

  /** Best live bank offer for this payment choice, or null (see pickBankOffer). */
  async bankOfferFor(
    payment: PaymentChoice,
    amountPaise: number,
    now = new Date(),
  ): Promise<BankOfferPick | null> {
    if (!payment || payment.type !== 'ONLINE') return null;
    const rows = await this.prisma.bankOffer.findMany({
      where: {
        active: true,
        provider: payment.provider,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
    });
    return pickBankOffer(
      rows.map((o) => ({
        ...o,
        maxDiscountPaise: o.maxDiscountPaise === null ? null : n(o.maxDiscountPaise),
        minOrderPaise: n(o.minOrderPaise),
      })),
      payment,
      amountPaise,
      now,
    );
  }

  async recordBankOffer(tx: Tx, orderId: string, offer: BankOfferPick): Promise<void> {
    await tx.bankOfferRedemption.create({
      data: { orderId, bankOfferId: offer.id, amountPaise: BigInt(offer.discountPaise) },
    });
  }
}
