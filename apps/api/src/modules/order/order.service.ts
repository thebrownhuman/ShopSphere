import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CheckoutAddress,
  DeliveryOptionType,
  OrderDetail,
  OrderPaymentMethod,
  OrderPaymentState,
  OrderRefund,
  OrdersPage,
  OrderStatus,
  OrderStatusResponse,
  OrderSummary,
  PaymentProviderName,
  ShipmentStatus,
} from '@shopsphere/types';
import { randomInt } from 'node:crypto';
import { CouponService } from '../coupon/coupon.service';
import { InventoryService } from '../inventory/inventory.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentService } from '../payment/payment.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import { CANCELLABLE, canTransition, eventTypeFor } from './order-state';

/** Online payment window (PRD §8): 15 min, extended to 30 while a payment is pending (M4.35). */
export const PAY_WINDOW_MS = 15 * 60 * 1000;
export const PENDING_PAY_WINDOW_MS = 30 * 60 * 1000;

const ORDER_WITH_ITEMS = {
  shipments: { include: { items: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_WITH_ITEMS }>;
type PlainOrder = Prisma.OrderGetPayload<object>;

export interface NewOrderItem {
  productId: string;
  skuId: string;
  offerId: string;
  sellerId: string;
  slug: string;
  title: string;
  variant: string | null;
  imageUrl: string | null;
  qty: number;
  unitPricePaise: number;
  mrpPaise: number;
  lineTotalPaise: number;
  discountPaise: number;
  gstRateBp: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface NewOrder {
  userId: string;
  checkoutId: string;
  idempotencyKey: string;
  paymentMethod: OrderPaymentMethod;
  paymentProvider: PaymentProviderName | null;
  totals: {
    itemsPaise: number;
    mrpPaise: number;
    deliveryPaise: number;
    couponDiscountPaise: number;
    codFeePaise: number;
    totalPaise: number;
    storeBalancePaise: number;
    payablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
  };
  coupon: { id: string; code: string } | null;
  address: CheckoutAddress;
  source: string;
  cartId: string | null;
  shipments: {
    sellerId: string;
    sellerName: string;
    sellerState: string;
    fulfilledByShopSphere: boolean;
    deliveryOption: DeliveryOptionType;
    deliveryFeePaise: number;
    promisedDate: string;
    items: NewOrderItem[];
  }[];
}

interface TransitionMeta {
  type: string;
  actor: 'customer' | 'system' | 'payment' | 'admin';
  note?: string | null;
  /** Extra outbox payload fields (see OrderEventPayloads). */
  payload?: Record<string, unknown>;
}

/** Follow-up work that must run after the transaction commits. */
export interface AfterCommit {
  refund: boolean;
}

const n = (v: bigint | number) => Number(v);

/** "OD" + yymmdd (UTC) + 10 random digits: unguessable enough for display, unique-indexed. */
export function newOrderNumber(now = new Date()): string {
  const d = now.toISOString().slice(2, 10).replace(/-/g, '');
  const tail =
    `${randomInt(0, 100_000)}`.padStart(5, '0') + `${randomInt(0, 100_000)}`.padStart(5, '0');
  return `OD${d}${tail}`;
}

/**
 * Orders (M4.15, M4.27, M4.29, M4.34, M4.35). Every status change goes through transition(),
 * which enforces the state machine, writes order_events and the outbox event in the caller's
 * transaction, and is guarded by a row lock on the order (lock()).
 */
@Injectable()
export class OrderService {
  private readonly log = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly ledger: LedgerService,
    private readonly coupons: CouponService,
    private readonly payments: PaymentService,
  ) {}

  // ───────── Core ─────────

  async lock(tx: Tx, orderId: string): Promise<PlainOrder | null> {
    if (!isUuid(orderId)) return null;
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id::text FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.order.findUnique({ where: { id: orderId } });
  }

  private base(o: PlainOrder, status: OrderStatus) {
    return {
      orderId: o.id,
      orderNumber: o.number,
      userId: o.userId,
      status,
      occurredAt: new Date().toISOString(),
    };
  }

  async transition(
    tx: Tx,
    o: PlainOrder,
    to: OrderStatus,
    meta: TransitionMeta,
  ): Promise<PlainOrder> {
    const from = o.status as OrderStatus;
    if (!canTransition(from, to)) {
      throw new AppError(
        'ORDER_TRANSITION_INVALID',
        `Order cannot go from ${from} to ${to}`,
        HttpStatus.CONFLICT,
        { from, to },
      );
    }
    const changed = await tx.$executeRaw`
      UPDATE orders SET status = ${to}, updated_at = now() WHERE id = ${o.id}::uuid AND status = ${from}`;
    if (changed !== 1)
      throw new AppError(
        'ORDER_TRANSITION_INVALID',
        'Order changed concurrently',
        HttpStatus.CONFLICT,
      );
    await tx.orderEventRow.create({
      data: {
        orderId: o.id,
        fromStatus: from,
        toStatus: to,
        type: meta.type,
        note: meta.note ?? null,
        actor: meta.actor,
      },
    });
    const type = eventTypeFor(to);
    await this.emit(tx, o, to, type, {
      ...(type === 'order.status_changed' ? { fromStatus: from } : {}),
      ...meta.payload,
    });
    return { ...o, status: to };
  }

  private emit(
    tx: Tx,
    o: PlainOrder,
    status: OrderStatus,
    eventType: string,
    extra: Record<string, unknown>,
  ) {
    return tx.outboxEvent.create({
      data: {
        aggregateType: 'order',
        aggregateId: o.id,
        eventType,
        payload: { ...this.base(o, status), ...extra } as Prisma.InputJsonValue,
      },
    });
  }

  /** Inserts the order graph in PENDING_PAYMENT and emits order.placed. Stock is reserved by the caller. */
  async create(tx: Tx, input: NewOrder, payBy: Date | null): Promise<PlainOrder> {
    const t = input.totals;
    const order = await tx.order.create({
      data: {
        number: newOrderNumber(),
        userId: input.userId,
        checkoutId: input.checkoutId,
        idempotencyKey: input.idempotencyKey,
        status: 'PENDING_PAYMENT',
        paymentMethod: input.paymentMethod,
        paymentProvider: input.paymentProvider,
        itemsPaise: BigInt(t.itemsPaise),
        mrpPaise: BigInt(t.mrpPaise),
        deliveryPaise: BigInt(t.deliveryPaise),
        couponDiscountPaise: BigInt(t.couponDiscountPaise),
        codFeePaise: BigInt(t.codFeePaise),
        totalPaise: BigInt(t.totalPaise),
        storeBalancePaise: BigInt(t.storeBalancePaise),
        payablePaise: BigInt(t.payablePaise),
        cgstPaise: BigInt(t.cgstPaise),
        sgstPaise: BigInt(t.sgstPaise),
        igstPaise: BigInt(t.igstPaise),
        couponId: input.coupon?.id ?? null,
        couponCode: input.coupon?.code ?? null,
        address: input.address as unknown as Prisma.InputJsonValue,
        shipToState: input.address.state,
        source: input.source,
        cartId: input.cartId,
        payBy,
      },
    });
    for (const s of input.shipments) {
      const shipment = await tx.shipment.create({
        data: {
          orderId: order.id,
          sellerId: s.sellerId,
          sellerName: s.sellerName,
          sellerState: s.sellerState,
          fulfilledByShopSphere: s.fulfilledByShopSphere,
          deliveryOption: s.deliveryOption,
          deliveryFeePaise: BigInt(s.deliveryFeePaise),
          promisedDate: s.promisedDate,
        },
      });
      await tx.orderItem.createMany({
        data: s.items.map((i) => ({
          ...i,
          orderId: order.id,
          shipmentId: shipment.id,
          unitPricePaise: BigInt(i.unitPricePaise),
          mrpPaise: BigInt(i.mrpPaise),
          lineTotalPaise: BigInt(i.lineTotalPaise),
          discountPaise: BigInt(i.discountPaise),
          taxablePaise: BigInt(i.taxablePaise),
          cgstPaise: BigInt(i.cgstPaise),
          sgstPaise: BigInt(i.sgstPaise),
          igstPaise: BigInt(i.igstPaise),
        })),
      });
    }
    await tx.orderEventRow.create({
      data: {
        orderId: order.id,
        fromStatus: null,
        toStatus: 'PENDING_PAYMENT',
        type: 'PLACED',
        actor: 'customer',
      },
    });
    await this.emit(tx, order, 'PENDING_PAYMENT', 'order.placed', {
      paymentMethod: input.paymentMethod,
      totalPaise: t.totalPaise,
      payablePaise: t.payablePaise,
      itemCount: input.shipments.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty, 0), 0),
    });
    return order;
  }

  /**
   * M4.15: reservation → stock deduction, coupon usage recorded, purchased lines removed from the
   * cart, shipments confirmed, order CONFIRMED + order.confirmed (invoice/notification trigger).
   */
  async confirm(
    tx: Tx,
    o: PlainOrder,
    opts: { lateCapture: boolean; actor: 'customer' | 'payment' },
  ): Promise<void> {
    await this.inventory.consume(tx, o.id);
    if (opts.lateCapture) await this.coupons.reinstate(tx, o.id);
    else await this.coupons.markUsed(tx, o.id);
    const items = await tx.orderItem.findMany({ where: { orderId: o.id } });
    if (o.cartId && o.source === 'CART') {
      await tx.cartItem.deleteMany({
        where: {
          cartId: o.cartId,
          OR: items.map((i) => ({ skuId: i.skuId, sellerId: i.sellerId })),
        },
      });
      await tx.$executeRaw`UPDATE carts SET version = version + 1, updated_at = now() WHERE id = ${o.cartId}::uuid`;
    }
    await tx.shipment.updateMany({ where: { orderId: o.id }, data: { status: 'CONFIRMED' } });
    await tx.order.update({ where: { id: o.id }, data: { confirmedAt: new Date(), payBy: null } });
    const shipments = await tx.shipment.findMany({
      where: { orderId: o.id },
      include: { items: true },
    });
    await this.transition(tx, o, 'CONFIRMED', {
      type: opts.lateCapture ? 'CONFIRMED_LATE_CAPTURE' : 'CONFIRMED',
      actor: opts.actor,
      payload: {
        paymentMethod: o.paymentMethod,
        totalPaise: n(o.totalPaise),
        payablePaise: n(o.payablePaise),
        lateCapture: opts.lateCapture,
        shipments: shipments.map((s) => ({
          shipmentId: s.id,
          sellerId: s.sellerId,
          sellerName: s.sellerName,
          sellerState: s.sellerState,
          shipToState: o.shipToState,
          promisedDate: s.promisedDate,
          items: s.items.map((i) => ({
            orderItemId: i.id,
            skuId: i.skuId,
            title: i.title,
            qty: i.qty,
            unitPricePaise: n(i.unitPricePaise),
            lineTotalPaise: n(i.lineTotalPaise),
            discountPaise: n(i.discountPaise),
            tax: {
              rateBp: i.gstRateBp,
              taxablePaise: n(i.taxablePaise),
              cgstPaise: n(i.cgstPaise),
              sgstPaise: n(i.sgstPaise),
              igstPaise: n(i.igstPaise),
            },
          })),
        })),
      },
    });
  }

  // ───────── Payment events (consumed from the payment outbox) ─────────

  /** Winning capture for an order. Returns follow-up work for after commit. */
  async onPaymentCaptured(tx: Tx, orderId: string): Promise<AfterCommit> {
    const o = await this.lock(tx, orderId);
    if (!o) return { refund: false };
    switch (o.status as OrderStatus) {
      case 'PENDING_PAYMENT':
        await this.confirm(tx, o, { lateCapture: false, actor: 'payment' });
        return { refund: false };
      case 'PAYMENT_FAILED':
        return this.lateCapture(tx, o);
      case 'CANCELLED':
      case 'CANCELLED_NO_STOCK':
        // Cancelled while the payment was in flight: give the money back.
        return { refund: true };
      default:
        return { refund: false };
    }
  }

  /**
   * M4.34: the capture arrived after the window closed and stock was released. Re-reserve and
   * confirm if everything is still there (stock and any store balance used); otherwise
   * CANCELLED_NO_STOCK, refund, and order.cancelled tells notifications to apologise.
   */
  private async lateCapture(tx: Tx, o: PlainOrder): Promise<AfterCommit> {
    const items = await tx.orderItem.findMany({ where: { orderId: o.id } });
    let ok =
      o.storeBalancePaise === 0n ||
      (await this.ledger.lockBalance(tx, o.userId)) >= o.storeBalancePaise;
    let reason = ok ? '' : 'STORE_BALANCE_UNAVAILABLE';
    if (ok) {
      const r = await this.inventory.reserve(
        tx,
        o.id,
        items.map((i) => ({ offerId: i.offerId, skuId: i.skuId, qty: i.qty })),
        new Date(Date.now() + PAY_WINDOW_MS),
      );
      ok = r.ok;
      if (!r.ok) reason = 'NO_STOCK';
    }
    if (ok) {
      await this.ledger.debitForOrder(tx, o.userId, o.id, o.storeBalancePaise, 1);
      await this.confirm(tx, o, { lateCapture: true, actor: 'payment' });
      return { refund: false };
    }
    await tx.order.update({
      where: { id: o.id },
      data: { cancelReason: reason, cancelledAt: new Date() },
    });
    await tx.shipment.updateMany({ where: { orderId: o.id }, data: { status: 'CANCELLED' } });
    await this.transition(tx, o, 'CANCELLED_NO_STOCK', {
      type: 'CANCELLED_NO_STOCK',
      actor: 'payment',
      note: reason,
      payload: {
        reason,
        cancelledBy: 'system',
        refunds: [{ destination: 'GATEWAY', amountPaise: n(o.payablePaise) }],
      },
    });
    return { refund: true };
  }

  /** An attempt failed; the order stays PENDING_PAYMENT and can be retried until payBy. */
  async onPaymentFailed(
    tx: Tx,
    orderId: string,
    info: { provider: string; reason: string | null },
  ): Promise<void> {
    const o = await this.lock(tx, orderId);
    if (!o || o.status !== 'PENDING_PAYMENT') return;
    await tx.orderEventRow.create({
      data: {
        orderId: o.id,
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'PENDING_PAYMENT',
        type: 'PAYMENT_ATTEMPT_FAILED',
        note: info.reason,
        actor: 'payment',
      },
    });
    await this.emit(tx, o, 'PENDING_PAYMENT', 'order.payment_failed', {
      reason: info.reason,
      provider: info.provider,
      retryUntil: o.payBy?.toISOString() ?? null,
    });
  }

  // ───────── Expiry (M4.2, M4.35) ─────────

  /**
   * Closes unpaid payment windows. A payment still PENDING at the gateway (UPI collect, net
   * banking) extends the window to 30 min from placement; after that the order expires anyway
   * and a late capture is handled by lateCapture().
   */
  async expireDue(now = new Date()): Promise<{ expired: number; extended: number }> {
    const due = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', payBy: { lt: now } },
      select: { id: true, placedAt: true },
      orderBy: { payBy: 'asc' },
      take: 200,
    });
    let expired = 0;
    let extended = 0;
    for (const { id, placedAt } of due) {
      try {
        const pay = await this.payments.status(id);
        if (pay.state === 'PAID') continue; // the capture event is being applied
        const longest = new Date(placedAt.getTime() + PENDING_PAY_WINDOW_MS);
        if (pay.state === 'PENDING' && longest > now) {
          await this.prisma.$transaction(async (tx) => {
            await tx.order.updateMany({
              where: { id, status: 'PENDING_PAYMENT' },
              data: { payBy: longest },
            });
            await this.inventory.extend(tx, id, longest);
          });
          extended += 1;
          continue;
        }
        if (await this.expire(id, now)) expired += 1;
      } catch (err) {
        this.log.warn(`expire ${id} failed: ${(err as Error).message}`);
      }
    }
    return { expired, extended };
  }

  /** PENDING_PAYMENT → PAYMENT_FAILED: release stock, store balance and coupon; cart untouched. */
  async expire(orderId: string, now = new Date(), force = false): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const o = await this.lock(tx, orderId);
      if (!o || o.status !== 'PENDING_PAYMENT' || o.paymentMethod !== 'ONLINE') return false;
      if (!force && (!o.payBy || o.payBy >= now)) return false;
      await this.inventory.release(tx, o.id);
      await this.ledger.creditForOrder(tx, o.userId, o.id, o.storeBalancePaise, 'expired');
      await this.coupons.release(tx, o.id);
      await this.transition(tx, o, 'PAYMENT_FAILED', {
        type: 'PAYMENT_EXPIRED',
        actor: 'system',
        payload: { payablePaise: n(o.payablePaise) },
      });
      return true;
    });
  }

  // ───────── Cancel (M4.29) ─────────

  async cancel(userId: string, orderId: string, reason: string | undefined): Promise<OrderDetail> {
    const after = await this.prisma.$transaction(async (tx) => {
      const o = await this.lock(tx, orderId);
      if (!o || o.userId !== userId) throw notFound();
      if (!CANCELLABLE.includes(o.status as OrderStatus)) {
        throw new AppError(
          'ORDER_NOT_CANCELLABLE',
          `This order can no longer be cancelled (${o.status})`,
          HttpStatus.CONFLICT,
        );
      }
      if (o.status === 'PENDING_PAYMENT') await this.inventory.release(tx, o.id);
      else await this.inventory.restock(tx, o.id);
      const balanceBack = await this.ledger.creditForOrder(
        tx,
        o.userId,
        o.id,
        o.storeBalancePaise,
        'cancelled',
      );
      await this.coupons.release(tx, o.id);
      const capture = await tx.orderPaymentCapture.findUnique({ where: { orderId: o.id } });
      const attempt = capture
        ? await tx.paymentAttempt.findUnique({ where: { id: capture.attemptId } })
        : null;
      await tx.shipment.updateMany({ where: { orderId: o.id }, data: { status: 'CANCELLED' } });
      const why = reason?.trim().slice(0, 200) || 'Cancelled by customer';
      await tx.order.update({
        where: { id: o.id },
        data: { cancelReason: why, cancelledAt: new Date(), payBy: null },
      });
      const refunds: { destination: string; amountPaise: number }[] = [];
      if (attempt) refunds.push({ destination: 'GATEWAY', amountPaise: n(attempt.amount) });
      if (balanceBack)
        refunds.push({ destination: 'STORE_BALANCE', amountPaise: n(o.storeBalancePaise) });
      await this.transition(tx, o, 'CANCELLED', {
        type: 'CANCELLED',
        actor: 'customer',
        note: why,
        payload: { reason: why, cancelledBy: 'customer', refunds },
      });
      if (balanceBack) {
        await this.emit(tx, o, 'CANCELLED', 'order.refund_issued', {
          destination: 'STORE_BALANCE',
          amountPaise: n(o.storeBalancePaise),
          reason: 'ORDER_CANCELLED',
        });
      }
      return { refund: !!attempt };
    });
    if (after.refund) await this.refundRemaining(orderId);
    return this.detail(userId, orderId);
  }

  /** Refunds whatever of the winning capture is not yet refunded (cancelled orders). Idempotent. */
  async refundRemaining(orderId: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ remaining: bigint }[]>`
      SELECT pa.amount - COALESCE((SELECT SUM(r.amount) FROM refunds r
                                   WHERE r.attempt_id = pa.id AND r.status <> 'FAILED'), 0) AS remaining
      FROM order_payment_captures c JOIN payment_attempts pa ON pa.id = c.attempt_id
      WHERE c.order_id = ${orderId}`;
    const remaining = rows[0]?.remaining ?? 0n;
    if (remaining <= 0n) return;
    try {
      await this.payments.requestRefund(orderId, BigInt(remaining), 'ORDER_CANCELLED');
    } catch (err) {
      // Left for refundSweep(); the gateway call itself is retried by payment reconciliation.
      this.log.warn(`refund for cancelled order ${orderId} not created: ${(err as Error).message}`);
    }
  }

  /** Safety net for crashes between a cancel commit and its refund request. */
  async refundSweep(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT o.id::text FROM orders o
      JOIN order_payment_captures c ON c.order_id = o.id::text
      JOIN payment_attempts pa ON pa.id = c.attempt_id
      WHERE o.status IN ('CANCELLED', 'CANCELLED_NO_STOCK')
        AND o.cancelled_at > now() - interval '3 days'
        AND pa.amount > COALESCE((SELECT SUM(r.amount) FROM refunds r
                                  WHERE r.attempt_id = pa.id AND r.status <> 'FAILED'), 0)
      LIMIT 100`;
    for (const r of rows) await this.refundRemaining(r.id);
    return rows.length;
  }

  // ───────── Reads ─────────

  async list(
    userId: string,
    q: { year?: number; status?: OrderStatus[]; cursor?: string; limit?: number },
  ): Promise<OrdersPage> {
    const limit = Math.min(Math.max(q.limit ?? 10, 1), 50);
    const where: Prisma.OrderWhereInput = { userId };
    if (q.year)
      where.placedAt = {
        gte: new Date(Date.UTC(q.year, 0, 1)),
        lt: new Date(Date.UTC(q.year + 1, 0, 1)),
      };
    if (q.status?.length) where.status = { in: q.status };
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      where.OR = [
        { placedAt: { lt: cursor.placedAt } },
        { placedAt: cursor.placedAt, id: { lt: cursor.id } },
      ];
    }
    const rows = await this.prisma.order.findMany({
      where,
      include: ORDER_WITH_ITEMS,
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((o) => this.summary(o)),
      nextCursor: rows.length > limit && last ? encodeCursor(last.placedAt, last.id) : null,
    };
  }

  private summary(o: OrderRow): OrderSummary {
    const items = o.shipments.flatMap((s) => s.items);
    return {
      id: o.id,
      number: o.number,
      status: o.status as OrderStatus,
      placedAt: o.placedAt.toISOString(),
      totalPaise: n(o.totalPaise),
      itemCount: items.reduce((s, i) => s + i.qty, 0),
      previews: items
        .slice(0, 3)
        .map((i) => ({ title: i.title, imageUrl: i.imageUrl, qty: i.qty })),
      paymentMethod: o.paymentMethod as OrderPaymentMethod,
    };
  }

  private async load(userId: string, orderId: string): Promise<OrderRow> {
    const o = isUuid(orderId)
      ? await this.prisma.order.findFirst({
          where: { id: orderId, userId },
          include: ORDER_WITH_ITEMS,
        })
      : null;
    if (!o) throw notFound();
    return o;
  }

  private async paymentState(
    o: PlainOrder,
  ): Promise<{ state: OrderPaymentState; refunds: OrderRefund[] }> {
    const refunds: OrderRefund[] = (await this.ledger.orderRefunds(o.id)).map((t) => ({
      id: t.id,
      destination: 'STORE_BALANCE',
      amountPaise: n(t.entries.find((e) => e.account.ownerType === 'USER')?.amountPaise ?? 0n),
      reason: 'ORDER_CANCELLED',
      status: 'PROCESSED',
      createdAt: t.createdAt.toISOString(),
    }));
    if (o.paymentMethod === 'COD') return { state: 'COD', refunds };
    if (o.paymentMethod === 'STORE_BALANCE') return { state: 'NOT_REQUIRED', refunds };
    const pay = await this.payments.status(o.id);
    const gatewayRefunds = await this.prisma.refund.findMany({
      where: { orderId: o.id },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of gatewayRefunds) {
      refunds.push({
        id: r.id,
        destination: 'GATEWAY',
        amountPaise: n(r.amount),
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      });
    }
    let state: OrderPaymentState = pay.state;
    const cancelled = o.status === 'CANCELLED' || o.status === 'CANCELLED_NO_STOCK';
    if (pay.state === 'PAID' && cancelled) {
      const mine = gatewayRefunds.filter(
        (r) => r.reason === 'ORDER_CANCELLED' || r.reason === 'CUSTOMER_REQUEST',
      );
      state =
        mine.length > 0 && mine.every((r) => r.status === 'PROCESSED')
          ? 'REFUNDED'
          : 'REFUND_PENDING';
    }
    return { state, refunds };
  }

  async detail(userId: string, orderId: string): Promise<OrderDetail> {
    const o = await this.load(userId, orderId);
    const [{ state, refunds }, events] = await Promise.all([
      this.paymentState(o),
      this.prisma.orderEventRow.findMany({
        where: { orderId: o.id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      ...this.summary(o),
      address: o.address as unknown as CheckoutAddress,
      totals: {
        itemsPaise: n(o.itemsPaise),
        mrpPaise: n(o.mrpPaise),
        deliveryPaise: n(o.deliveryPaise),
        couponDiscountPaise: n(o.couponDiscountPaise),
        codFeePaise: n(o.codFeePaise),
        totalPaise: n(o.totalPaise),
        storeBalancePaise: n(o.storeBalancePaise),
        payablePaise: n(o.payablePaise),
        tax: {
          cgstPaise: n(o.cgstPaise),
          sgstPaise: n(o.sgstPaise),
          igstPaise: n(o.igstPaise),
          totalPaise: n(o.cgstPaise + o.sgstPaise + o.igstPaise),
        },
      },
      shipments: o.shipments.map((s) => ({
        id: s.id,
        sellerId: s.sellerId,
        sellerName: s.sellerName,
        sellerState: s.sellerState,
        fulfilledByShopSphere: s.fulfilledByShopSphere,
        deliveryOption: s.deliveryOption as DeliveryOptionType,
        deliveryFeePaise: n(s.deliveryFeePaise),
        promisedDate: s.promisedDate,
        status: s.status as ShipmentStatus,
        items: s.items.map((i) => ({
          id: i.id,
          productId: i.productId,
          skuId: i.skuId,
          sellerId: i.sellerId,
          slug: i.slug,
          title: i.title,
          variant: i.variant,
          imageUrl: i.imageUrl,
          qty: i.qty,
          unitPricePaise: n(i.unitPricePaise),
          mrpPaise: n(i.mrpPaise),
          lineTotalPaise: n(i.lineTotalPaise),
          discountPaise: n(i.discountPaise),
          tax: {
            rateBp: i.gstRateBp,
            taxablePaise: n(i.taxablePaise),
            cgstPaise: n(i.cgstPaise),
            sgstPaise: n(i.sgstPaise),
            igstPaise: n(i.igstPaise),
          },
        })),
      })),
      payment: {
        method: o.paymentMethod as OrderPaymentMethod,
        state,
        provider: (o.paymentProvider as PaymentProviderName | null) ?? null,
        retryUntil: o.status === 'PENDING_PAYMENT' && o.payBy ? o.payBy.toISOString() : null,
      },
      coupon: o.couponCode ? { code: o.couponCode, discountPaise: n(o.couponDiscountPaise) } : null,
      refunds,
      events: events.map((e) => ({
        id: e.id,
        fromStatus: e.fromStatus as OrderStatus | null,
        toStatus: e.toStatus as OrderStatus,
        type: e.type,
        note: e.note,
        actor: e.actor,
        createdAt: e.createdAt.toISOString(),
      })),
      canCancel: CANCELLABLE.includes(o.status as OrderStatus),
      cancelReason: o.cancelReason,
    };
  }

  async status(userId: string, orderId: string): Promise<OrderStatusResponse> {
    const o = isUuid(orderId)
      ? await this.prisma.order.findFirst({ where: { id: orderId, userId } })
      : null;
    if (!o) throw notFound();
    const { state } = await this.paymentState(o);
    return {
      orderId: o.id,
      status: o.status as OrderStatus,
      paymentState: state,
      payablePaise: n(o.payablePaise),
      retryUntil: o.status === 'PENDING_PAYMENT' && o.payBy ? o.payBy.toISOString() : null,
      updatedAt: o.updatedAt.toISOString(),
    };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

const notFound = () => new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);

function encodeCursor(placedAt: Date, id: string): string {
  return Buffer.from(`${placedAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(c?: string): { placedAt: Date; id: string } | null {
  if (!c) return null;
  const [iso, id] = Buffer.from(c, 'base64url').toString().split('|');
  const placedAt = new Date(iso);
  return Number.isNaN(placedAt.getTime()) || !id || !isUuid(id) ? null : { placedAt, id };
}
