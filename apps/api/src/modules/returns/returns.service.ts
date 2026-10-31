import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CheckoutAddress,
  CourierWebhookEvent,
  CreateReturnRequest,
  OrderStatus,
  QcRequest,
  RefundTarget,
  ReturnInfo,
  ReturnReason,
  ReturnStatus,
  ReturnView,
  SellerReturn,
} from '@shopsphere/types';
import { InventoryService } from '../inventory/inventory.service';
import { LedgerService } from '../ledger/ledger.service';
import { isUuid, OrderService } from '../order/order.service';
import { PaymentService } from '../payment/payment.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import { CourierRegistry } from '../shipping/courier.registry';
import { CourierError } from '../shipping/providers/courier-provider';
import {
  checkEligibility,
  COURIER_TO_RETURN,
  pickupDates,
  returnTrackingApplies,
} from './return-policy';

type ReturnRow = Prisma.ReturnRequestGetPayload<object>;
type PlainOrder = Prisma.OrderGetPayload<object>;

export interface ReturnTrackingResult {
  duplicate: boolean;
  applied: boolean;
  returnStatus: ReturnStatus;
  orderStatus: OrderStatus;
}

const n = (v: bigint | number) => Number(v);
const DEFAULT_WEIGHT_GRAMS = 500;
/** Courier reference for a reverse pickup (the courier dedupes bookings on it). */
const reference = (returnId: string) => `RET-${returnId}`;

const notFound = () => new AppError('NOT_FOUND', 'Return not found', HttpStatus.NOT_FOUND);

function view(r: ReturnRow): ReturnView {
  return {
    id: r.id,
    orderId: r.orderId,
    status: r.status as ReturnStatus,
    reason: r.reason as ReturnReason,
    comment: r.comment,
    refundTo: r.refundTo as RefundTarget,
    amountPaise: n(r.amountPaise),
    pickupDate: r.pickupDate,
    awb: r.awb,
    qcNote: r.qcNote,
    createdAt: r.createdAt.toISOString(),
    pickedUpAt: r.pickedUpAt?.toISOString() ?? null,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    refundedAt: r.refundedAt?.toISOString() ?? null,
  };
}

/**
 * Returns (M6.1). Order level: DELIVERED → RETURN_REQUESTED (customer) → PICKED_UP (courier
 * reverse-pickup webhook) → REFUNDED (seller QC pass on receipt), all through
 * OrderService.transition so order_events + outbox events are written in the same transaction.
 * The seller's settlement line is held while a return is open and reversed on refund.
 */
@Injectable()
export class ReturnsService {
  private readonly log = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly inventory: InventoryService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentService,
    private readonly couriers: CourierRegistry,
  ) {}

  // ───────── Shopper ─────────

  async info(userId: string, orderId: string, now = new Date()): Promise<ReturnInfo> {
    const o = isUuid(orderId)
      ? await this.prisma.order.findFirst({ where: { id: orderId, userId } })
      : null;
    if (!o) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    const current = await this.prisma.returnRequest.findUnique({ where: { orderId } });
    const elig = await this.eligibility(this.prisma, o, now);
    const eligible = elig.eligible && !current;
    return {
      orderId,
      orderStatus: o.status as OrderStatus,
      eligible,
      reason: current
        ? 'A return was already requested for this order'
        : elig.eligible
          ? null
          : elig.reason,
      windowEndsAt: elig.windowEndsAt?.toISOString() ?? null,
      windowDays: elig.windowDays,
      pickupDates: eligible ? pickupDates(now) : [],
      refundTargets: refundTargets(o),
      refundPaise: n(o.totalPaise),
      current: current ? view(current) : null,
    };
  }

  async create(userId: string, orderId: string, body: CreateReturnRequest): Promise<ReturnView> {
    if (!pickupDates().includes(body.pickupDate)) {
      throw new AppError('VALIDATION_FAILED', 'Choose one of the offered pickup days', 422);
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const o = await this.orders.lock(tx, orderId);
      if (!o || o.userId !== userId) {
        throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
      }
      if (await tx.returnRequest.findUnique({ where: { orderId } })) {
        throw new AppError(
          'RETURN_EXISTS',
          'A return was already requested for this order',
          HttpStatus.CONFLICT,
        );
      }
      const elig = await this.eligibility(tx, o);
      if (!elig.eligible) {
        throw new AppError('RETURN_NOT_ELIGIBLE', elig.reason, HttpStatus.CONFLICT);
      }
      if (!refundTargets(o).includes(body.refundTo)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Cash on Delivery orders are refunded to ShopSphere Pay balance',
          422,
        );
      }
      const shipments = await tx.shipment.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      const r = await tx.returnRequest.create({
        data: {
          orderId,
          userId,
          sellerId: shipments[0].sellerId,
          reason: body.reason,
          comment: body.comment?.trim().slice(0, 500) || null,
          refundTo: body.refundTo,
          amountPaise: o.totalPaise,
          pickupDate: body.pickupDate,
        },
      });
      await tx.settlementLine.updateMany({
        where: { orderId, status: 'PENDING' },
        data: { status: 'RETURN_HOLD' },
      });
      await this.orders.transition(tx, o, 'RETURN_REQUESTED', {
        type: 'RETURN_REQUESTED',
        actor: 'customer',
        note: body.reason,
        payload: {
          returnId: r.id,
          reason: body.reason,
          refundTo: body.refundTo,
          pickupDate: body.pickupDate,
        },
      });
      return r;
    });
    try {
      return view(await this.bookPickup(created.id));
    } catch (err) {
      // The return stands; the seller can re-book the pickup from Seller Central.
      this.log.warn(`pickup for return ${created.id} not booked: ${(err as Error).message}`);
      return view(created);
    }
  }

  // ───────── Courier ─────────

  /** Books the reverse pickup (customer → seller). Idempotent: a booked return is returned as is. */
  async bookPickup(returnId: string): Promise<ReturnRow> {
    const r = await this.prisma.returnRequest.findUniqueOrThrow({ where: { id: returnId } });
    if (r.awb) return r;
    const o = await this.prisma.order.findUniqueOrThrow({
      where: { id: r.orderId },
      include: { shipments: true },
    });
    const seller = await this.prisma.seller.findUniqueOrThrow({ where: { id: r.sellerId } });
    const address = o.address as unknown as CheckoutAddress;
    const courier = this.couriers.active;
    let booked;
    try {
      booked = await courier.createShipment({
        reference: reference(r.id),
        fromPincode: address.pincode,
        toPincode: seller.pincode,
        weightGrams:
          o.shipments.reduce((t, s) => t + (s.weightGrams ?? 0), 0) || DEFAULT_WEIGHT_GRAMS,
        cod: false,
        codAmountPaise: 0,
        sender: address.name,
        consignee: { name: seller.name, city: seller.city, state: seller.state },
      });
    } catch (err) {
      if (err instanceof CourierError) {
        throw new AppError('COURIER_UNAVAILABLE', err.message, HttpStatus.BAD_GATEWAY);
      }
      throw err;
    }
    await this.prisma.returnRequest.updateMany({
      where: { id: r.id, awb: null },
      data: { awb: booked.awb, courier: courier.name, status: 'PICKUP_SCHEDULED' },
    });
    return this.prisma.returnRequest.findUniqueOrThrow({ where: { id: r.id } });
  }

  /** True when the AWB belongs to a reverse pickup (shared courier webhook URL). */
  async ownsAwb(provider: string, awb: string): Promise<boolean> {
    return (await this.prisma.returnRequest.count({ where: { courier: provider, awb } })) > 0;
  }

  async handleWebhook(
    provider: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<ReturnTrackingResult> {
    const event = rawBody ? this.couriers.get(provider).parseWebhook(rawBody, headers) : null;
    if (!event) throw new AppError('UNAUTHORIZED', 'Invalid webhook', HttpStatus.UNAUTHORIZED);
    return this.applyTracking(provider, event);
  }

  /** Idempotent per (provider, eventId); duplicates and out-of-order statuses change nothing. */
  async applyTracking(provider: string, e: CourierWebhookEvent): Promise<ReturnTrackingResult> {
    const found = await this.prisma.returnRequest.findFirst({
      where: { courier: provider, awb: e.awb },
      select: { id: true, orderId: true },
    });
    if (!found) throw new AppError('NOT_FOUND', `Unknown AWB ${e.awb}`, HttpStatus.NOT_FOUND);
    return this.prisma.$transaction(async (tx) => {
      let o = (await this.orders.lock(tx, found.orderId))!;
      const r = await tx.returnRequest.findUniqueOrThrow({ where: { id: found.id } });
      const current = r.status as ReturnStatus;
      const next = COURIER_TO_RETURN[e.status];
      const applies = !!next && returnTrackingApplies(current, next);
      const inserted = await tx.returnTrackingEvent.createMany({
        data: [
          {
            returnId: r.id,
            provider,
            providerEventId: e.eventId,
            status: e.status,
            sequence: e.sequence,
            location: e.location,
            applied: applies,
            occurredAt: new Date(e.occurredAt),
          },
        ],
        skipDuplicates: true,
      });
      const result = { returnStatus: current, orderStatus: o.status as OrderStatus };
      if (inserted.count === 0) return { duplicate: true, applied: false, ...result };
      if (!applies) return { duplicate: false, applied: false, ...result };

      const at = new Date(e.occurredAt);
      await tx.returnRequest.update({
        where: { id: r.id },
        data: {
          status: next,
          trackingSeq: Math.max(r.trackingSeq, e.sequence),
          pickedUpAt: r.pickedUpAt ?? at,
          ...(next === 'RECEIVED' ? { receivedAt: at } : {}),
        },
      });
      if (o.status === 'RETURN_REQUESTED') {
        o = await this.orders.transition(tx, o, 'PICKED_UP', {
          type: 'RETURN_PICKED_UP',
          actor: 'courier',
          payload: { returnId: r.id, courier: provider, awb: e.awb },
        });
      }
      return {
        duplicate: false,
        applied: true,
        returnStatus: next,
        orderStatus: o.status as OrderStatus,
      };
    });
  }

  // ───────── Seller ─────────

  async sellerList(sellerId: string, status?: ReturnStatus): Promise<{ items: SellerReturn[] }> {
    const rows = await this.prisma.returnRequest.findMany({
      where: { sellerId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: await Promise.all(rows.map((r) => this.sellerView(r))) };
  }

  async rebookPickup(sellerId: string, id: string): Promise<SellerReturn> {
    await this.findForSeller(sellerId, id);
    return this.sellerView(await this.bookPickup(id));
  }

  /** QC on receipt. PASS restocks and refunds (to the shopper's chosen target); FAIL keeps the money. */
  async qc(sellerId: string, id: string, body: QcRequest): Promise<SellerReturn> {
    const found = await this.findForSeller(sellerId, id);
    const gateway = await this.prisma.$transaction(async (tx) => {
      const o = (await this.orders.lock(tx, found.orderId))!;
      const r = await tx.returnRequest.findUniqueOrThrow({ where: { id } });
      if (r.status !== 'RECEIVED') {
        throw new AppError(
          'RETURN_STATE_INVALID',
          `QC needs a received return (is ${r.status})`,
          HttpStatus.CONFLICT,
        );
      }
      const note = body.note?.trim().slice(0, 500) || null;
      if (body.result === 'FAIL') {
        await tx.returnRequest.update({
          where: { id },
          data: { status: 'QC_FAILED', qcNote: note, qcAt: new Date() },
        });
        await tx.settlementLine.updateMany({
          where: { orderId: o.id, status: 'RETURN_HOLD' },
          data: { status: 'PENDING' },
        });
        return 0n;
      }
      return this.refund(tx, o, r, note);
    });
    if (gateway > 0n) {
      try {
        await this.payments.requestRefund(found.orderId, gateway, 'CUSTOMER_REQUEST');
      } catch (err) {
        // The refund row is retried by payment reconciliation once created; log anything earlier.
        this.log.error(`gateway refund for return ${id} failed: ${(err as Error).message}`);
      }
    }
    return this.sellerView(await this.prisma.returnRequest.findUniqueOrThrow({ where: { id } }));
  }

  /** Inside the QC transaction. Returns the amount still to refund through the gateway. */
  private async refund(tx: Tx, o: PlainOrder, r: ReturnRow, note: string | null): Promise<bigint> {
    await this.inventory.restock(tx, o.id);
    const refunds: { destination: string; amountPaise: number }[] = [];
    let gateway = 0n;
    if (r.refundTo === 'STORE_BALANCE') {
      await this.ledger.creditForOrder(tx, o.userId, o.id, o.totalPaise, 'returned');
      refunds.push({ destination: 'STORE_BALANCE', amountPaise: n(o.totalPaise) });
    } else {
      if (await this.ledger.creditForOrder(tx, o.userId, o.id, o.storeBalancePaise, 'returned')) {
        refunds.push({ destination: 'STORE_BALANCE', amountPaise: n(o.storeBalancePaise) });
      }
      gateway = await this.gatewayRemaining(tx, o.id);
      if (gateway > 0n) refunds.push({ destination: 'GATEWAY', amountPaise: n(gateway) });
    }
    await tx.returnRequest.update({
      where: { id: r.id },
      data: { status: 'REFUNDED', qcNote: note, qcAt: new Date(), refundedAt: new Date() },
    });
    await tx.settlementLine.updateMany({
      where: { orderId: o.id, status: { in: ['RETURN_HOLD', 'PENDING'] } },
      data: { status: 'REVERSED' },
    });
    await this.orders.transition(tx, o, 'REFUNDED', {
      type: 'RETURN_REFUNDED',
      actor: 'seller',
      note,
      payload: { returnId: r.id, refundTo: r.refundTo, refunds },
    });
    return gateway;
  }

  private async gatewayRemaining(tx: Tx, orderId: string): Promise<bigint> {
    const rows = await tx.$queryRaw<{ remaining: bigint }[]>`
      SELECT pa.amount - COALESCE((SELECT SUM(r.amount) FROM refunds r
                                   WHERE r.attempt_id = pa.id AND r.status <> 'FAILED'), 0) AS remaining
      FROM order_payment_captures c JOIN payment_attempts pa ON pa.id = c.attempt_id
      WHERE c.order_id = ${orderId}`;
    const remaining = rows[0]?.remaining ?? 0n;
    return remaining > 0n ? BigInt(remaining) : 0n;
  }

  // ───────── Internals ─────────

  private async eligibility(db: Tx | PrismaService, o: PlainOrder, now = new Date()) {
    const shipments = await db.shipment.findMany({
      where: { orderId: o.id },
      select: { deliveredAt: true },
    });
    const delivered = shipments.map((s) => s.deliveredAt?.getTime() ?? 0);
    const items = await db.orderItem.findMany({
      where: { orderId: o.id },
      select: { productId: true },
    });
    const roots = await this.rootSlugs(
      db,
      items.map((i) => i.productId),
    );
    return checkEligibility({
      orderStatus: o.status,
      deliveredAt:
        delivered.length && Math.max(...delivered) > 0 ? new Date(Math.max(...delivered)) : null,
      itemRootSlugs: items.map((i) => roots.get(i.productId) ?? null),
      now,
    });
  }

  /** Top-level category slug per product. */
  private async rootSlugs(db: Tx | PrismaService, productIds: string[]) {
    if (!productIds.length) return new Map<string, string>();
    const rows = await db.$queryRaw<{ product_id: string; slug: string }[]>`
      WITH RECURSIVE up AS (
        SELECT p.id AS product_id, c.parent_id, c.slug
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.id = ANY(${productIds}::uuid[])
        UNION ALL
        SELECT up.product_id, c.parent_id, c.slug FROM up JOIN categories c ON c.id = up.parent_id
      )
      SELECT product_id::text, slug FROM up WHERE parent_id IS NULL`;
    return new Map(rows.map((r) => [r.product_id, r.slug]));
  }

  private async findForSeller(sellerId: string, id: string): Promise<ReturnRow> {
    const r = isUuid(id)
      ? await this.prisma.returnRequest.findFirst({ where: { id, sellerId } })
      : null;
    if (!r) throw notFound();
    return r;
  }

  private async sellerView(r: ReturnRow): Promise<SellerReturn> {
    const o = await this.prisma.order.findUniqueOrThrow({
      where: { id: r.orderId },
      include: { shipments: { include: { items: true } } },
    });
    const address = o.address as unknown as CheckoutAddress;
    return {
      ...view(r),
      orderNumber: o.number,
      items: o.shipments
        .filter((s) => s.sellerId === r.sellerId)
        .flatMap((s) => s.items)
        .map((i) => ({ title: i.title, variant: i.variant, qty: i.qty })),
      pickupFrom: { city: address.city, pincode: address.pincode },
    };
  }
}

/** COD orders have nothing to refund to: store balance only (PRD §9 simulates the bank/UPI payout). */
function refundTargets(o: PlainOrder): RefundTarget[] {
  return o.paymentMethod === 'COD' ? ['STORE_BALANCE'] : ['ORIGINAL', 'STORE_BALANCE'];
}
