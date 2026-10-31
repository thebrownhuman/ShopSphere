import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CheckoutAddress,
  CourierWebhookEvent,
  OrderStatus,
  SellerOrdersPage,
  SellerShipment,
  SellerShipmentDetail,
  ShipmentStatus,
} from '@shopsphere/types';
import { OrderService } from '../order/order.service';
import { SettlementService } from '../settlement/settlement.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import { CourierRegistry } from '../shipping/courier.registry';
import { CourierError } from '../shipping/providers/courier-provider';
import { SHIPPING_CONFIG, type ShippingConfig } from '../shipping/shipping.config';
import { orderPath, orderTargetFor, trackingApplies } from './fulfilment-state';

const n = (v: bigint | number) => Number(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Orders a seller may see: paid (or COD-confirmed) and onward. */
const HIDDEN_ORDER_STATUSES = ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CANCELLED_NO_STOCK'];

const shipmentInclude = {
  items: true,
  order: {
    select: {
      id: true,
      number: true,
      status: true,
      address: true,
      paymentMethod: true,
      payablePaise: true,
      placedAt: true,
    },
  },
} satisfies Prisma.ShipmentInclude;
type ShipmentRow = Prisma.ShipmentGetPayload<{ include: typeof shipmentInclude }>;

export interface TrackingResult {
  duplicate: boolean;
  applied: boolean;
  shipmentStatus: ShipmentStatus;
  orderStatus: OrderStatus;
}

/**
 * Seller order queue and courier-driven shipment tracking (M5.5, M5.6). Shipment status moves
 * PENDING → ACCEPTED → PACKED → LABEL_CREATED by the seller, then SHIPPED → OUT_FOR_DELIVERY →
 * DELIVERED by courier webhooks. Every change re-derives the order status and moves it through
 * OrderService.transition() (M4 state machine + outbox), under the order row lock.
 */
@Injectable()
export class FulfilmentService {
  private readonly log = new Logger(FulfilmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly couriers: CourierRegistry,
    private readonly settlement: SettlementService,
    @Inject(SHIPPING_CONFIG) private readonly cfg: ShippingConfig,
  ) {}

  // ───────── Seller queue ─────────

  async list(
    sellerId: string,
    q: { status?: ShipmentStatus[]; cursor?: string; limit?: number },
  ): Promise<SellerOrdersPage> {
    const limit = q.limit ?? 20;
    const rows = await this.prisma.shipment.findMany({
      where: {
        sellerId,
        ...(q.status?.length ? { status: { in: q.status } } : {}),
        order: { status: { notIn: HIDDEN_ORDER_STATUSES } },
      },
      include: shipmentInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor && UUID.test(q.cursor) ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(view),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async detail(sellerId: string, shipmentId: string): Promise<SellerShipmentDetail> {
    const s = await this.find(sellerId, shipmentId);
    const tracking = await this.prisma.shipmentTrackingEvent.findMany({
      where: { shipmentId: s.id },
      orderBy: [{ occurredAt: 'asc' }, { sequence: 'asc' }],
    });
    return {
      ...view(s),
      tracking: tracking.map((t) => ({
        status: t.status as SellerShipmentDetail['tracking'][number]['status'],
        location: t.location,
        occurredAt: t.occurredAt.toISOString(),
        applied: t.applied,
      })),
    };
  }

  async accept(sellerId: string, shipmentId: string): Promise<SellerShipment> {
    const s = await this.find(sellerId, shipmentId);
    await this.prisma.$transaction(async (tx) => {
      const o = await this.orders.lock(tx, s.orderId);
      if (o?.status !== 'CONFIRMED') {
        throw new AppError(
          'SHIPMENT_STATE_INVALID',
          `Order is ${o?.status ?? 'missing'}; only confirmed orders can be accepted`,
          HttpStatus.CONFLICT,
        );
      }
      await this.move(tx, s.id, 'CONFIRMED', 'ACCEPTED', { acceptedAt: new Date() });
    });
    return view(await this.find(sellerId, shipmentId));
  }

  async pack(sellerId: string, shipmentId: string, weightGrams?: number): Promise<SellerShipment> {
    const s = await this.find(sellerId, shipmentId);
    const units = s.items.reduce((sum, i) => sum + i.qty, 0);
    await this.prisma.$transaction(async (tx) => {
      assertLive(await this.orders.lock(tx, s.orderId));
      await this.move(tx, s.id, 'ACCEPTED', 'PACKED', {
        packedAt: new Date(),
        weightGrams: weightGrams ?? units * this.cfg.DEFAULT_UNIT_WEIGHT_GRAMS,
      });
      await this.syncOrder(tx, s.orderId, 'seller', { shipmentId: s.id });
    });
    return view(await this.find(sellerId, shipmentId));
  }

  /**
   * Books the courier and stores AWB + rate. The courier call happens outside the transaction
   * and is idempotent on our shipment id, so a retry after a crash gets the same AWB.
   */
  async label(sellerId: string, shipmentId: string): Promise<SellerShipment> {
    const s = await this.find(sellerId, shipmentId);
    if (s.status === 'LABEL_CREATED' || (s.awb && s.status !== 'PACKED')) return view(s);
    if (s.status !== 'PACKED') {
      throw new AppError(
        'SHIPMENT_STATE_INVALID',
        `Shipment is ${s.status}; pack it first`,
        HttpStatus.CONFLICT,
      );
    }
    const seller = await this.prisma.seller.findUniqueOrThrow({ where: { id: s.sellerId } });
    const address = s.order.address as unknown as CheckoutAddress;
    const courier = this.couriers.active;
    let booked;
    try {
      booked = await courier.createShipment({
        reference: s.id,
        fromPincode: seller.pincode,
        toPincode: address.pincode,
        weightGrams: s.weightGrams ?? this.cfg.DEFAULT_UNIT_WEIGHT_GRAMS,
        cod: s.order.paymentMethod === 'COD',
        codAmountPaise: s.order.paymentMethod === 'COD' ? n(s.order.payablePaise) : 0,
        sender: seller.name,
        consignee: { name: address.name, city: address.city, state: address.state },
      });
    } catch (err) {
      if (err instanceof CourierError) {
        throw new AppError(
          err.status === 422 ? 'NOT_SERVICEABLE' : 'COURIER_UNAVAILABLE',
          err.message,
          err.status === 422 ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.BAD_GATEWAY,
        );
      }
      throw err;
    }
    await this.prisma.$transaction(async (tx) => {
      assertLive(await this.orders.lock(tx, s.orderId));
      await this.move(tx, s.id, 'PACKED', 'LABEL_CREATED', {
        labelAt: new Date(),
        courier: courier.name,
        awb: booked.awb,
        shippingCostPaise: BigInt(booked.ratePaise),
      });
    });
    return view(await this.find(sellerId, shipmentId));
  }

  async labelPdf(sellerId: string, shipmentId: string): Promise<{ awb: string; pdf: Buffer }> {
    const s = await this.find(sellerId, shipmentId);
    if (!s.awb || !s.courier) {
      throw new AppError('SHIPMENT_STATE_INVALID', 'No label yet', HttpStatus.CONFLICT);
    }
    return { awb: s.awb, pdf: await this.couriers.get(s.courier).label(s.awb) };
  }

  // ───────── Courier tracking ─────────

  /** Verifies and applies a courier webhook. Unknown AWBs answer 404 so the courier retries. */
  async handleWebhook(
    provider: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<TrackingResult> {
    const event = rawBody ? this.couriers.get(provider).parseWebhook(rawBody, headers) : null;
    if (!event) throw new AppError('UNAUTHORIZED', 'Invalid webhook', HttpStatus.UNAUTHORIZED);
    return this.applyTracking(provider, event);
  }

  /**
   * Idempotent per (provider, eventId); out-of-order and duplicate statuses are recorded with
   * applied=false and change nothing.
   */
  async applyTracking(provider: string, e: CourierWebhookEvent): Promise<TrackingResult> {
    const found = await this.prisma.shipment.findFirst({
      where: { courier: provider, awb: e.awb },
      select: { id: true, orderId: true },
    });
    if (!found) throw new AppError('NOT_FOUND', `Unknown AWB ${e.awb}`, HttpStatus.NOT_FOUND);
    return this.prisma.$transaction(async (tx) => {
      const o = await this.orders.lock(tx, found.orderId);
      const s = await tx.shipment.findUniqueOrThrow({ where: { id: found.id } });
      const current = s.status as ShipmentStatus;
      const applies = trackingApplies(current, e.status);
      const inserted = await tx.shipmentTrackingEvent.createMany({
        data: [
          {
            shipmentId: s.id,
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
      const result = { shipmentStatus: current, orderStatus: o!.status as OrderStatus };
      if (inserted.count === 0) return { duplicate: true, applied: false, ...result };
      if (!applies) return { duplicate: false, applied: false, ...result };

      const at = new Date(e.occurredAt);
      const stamps: Prisma.ShipmentUpdateInput =
        e.status === 'SHIPPED'
          ? { shippedAt: at }
          : e.status === 'OUT_FOR_DELIVERY'
            ? { outForDeliveryAt: at, shippedAt: s.shippedAt ?? at }
            : { deliveredAt: at, shippedAt: s.shippedAt ?? at };
      await this.move(tx, s.id, current, e.status, {
        ...stamps,
        trackingSeq: Math.max(s.trackingSeq, e.sequence),
      });
      if (e.status === 'DELIVERED') await this.settlement.recordDelivery(tx, s.id, at);
      const orderStatus = await this.syncOrder(tx, s.orderId, 'courier', {
        shipmentId: s.id,
        courier: provider,
        awb: e.awb,
      });
      return { duplicate: false, applied: true, shipmentStatus: e.status, orderStatus };
    });
  }

  /** Polls the courier for shipments in transit: recovers webhooks that never arrived. */
  async syncTracking(): Promise<{ checked: number; applied: number }> {
    const open = await this.prisma.shipment.findMany({
      where: {
        status: { in: ['LABEL_CREATED', 'SHIPPED', 'OUT_FOR_DELIVERY'] },
        awb: { not: null },
      },
      select: { courier: true, awb: true },
      take: 500,
    });
    let applied = 0;
    for (const s of open) {
      try {
        const snap = await this.couriers.get(s.courier!).track(s.awb!);
        for (const ev of [...snap.events].sort((a, b) => a.sequence - b.sequence)) {
          const r = await this.applyTracking(s.courier!, { ...ev, awb: s.awb!, reference: '' });
          if (r.applied) applied += 1;
        }
      } catch (err) {
        this.log.warn(`tracking sync ${s.awb} failed: ${(err as Error).message}`);
      }
    }
    return { checked: open.length, applied };
  }

  // ───────── Internals ─────────

  private async find(sellerId: string, shipmentId: string): Promise<ShipmentRow> {
    const s = UUID.test(shipmentId)
      ? await this.prisma.shipment.findFirst({
          where: { id: shipmentId, sellerId, order: { status: { notIn: HIDDEN_ORDER_STATUSES } } },
          include: shipmentInclude,
        })
      : null;
    if (!s) throw new AppError('NOT_FOUND', 'Shipment not found', HttpStatus.NOT_FOUND);
    return s;
  }

  /** Compare-and-set on shipment status; the caller holds the order lock. */
  private async move(
    tx: Tx,
    shipmentId: string,
    from: ShipmentStatus,
    to: ShipmentStatus,
    data: Prisma.ShipmentUpdateInput,
  ): Promise<void> {
    const r = await tx.shipment.updateMany({
      where: { id: shipmentId, status: from },
      data: { ...(data as Prisma.ShipmentUpdateManyMutationInput), status: to },
    });
    if (r.count !== 1) {
      const cur = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { status: true },
      });
      throw new AppError(
        'SHIPMENT_STATE_INVALID',
        `Shipment is ${cur?.status ?? 'missing'}, expected ${from}`,
        HttpStatus.CONFLICT,
        { from: cur?.status, to },
      );
    }
  }

  /** Moves the order to what its shipments say, one allowed transition at a time. */
  private async syncOrder(
    tx: Tx,
    orderId: string,
    actor: 'seller' | 'courier',
    payload: Record<string, unknown>,
  ): Promise<OrderStatus> {
    let o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const shipments = await tx.shipment.findMany({ where: { orderId }, select: { status: true } });
    const target = orderTargetFor(shipments.map((s) => s.status as ShipmentStatus));
    if (!target) return o.status as OrderStatus;
    for (const to of orderPath(o.status as OrderStatus, target)) {
      o = await this.orders.transition(tx, o, to, {
        type: `fulfilment.${to.toLowerCase()}`,
        actor,
        payload,
      });
    }
    return o.status as OrderStatus;
  }
}

/** Customers may cancel until the order ships; the seller must stop working on it. */
function assertLive(o: { status: string } | null): void {
  if (!o || !['CONFIRMED', 'PACKED'].includes(o.status)) {
    throw new AppError(
      'SHIPMENT_STATE_INVALID',
      `Order is ${o?.status ?? 'missing'}`,
      HttpStatus.CONFLICT,
    );
  }
}

function view(s: ShipmentRow): SellerShipment {
  const a = s.order.address as unknown as CheckoutAddress;
  return {
    id: s.id,
    orderId: s.orderId,
    orderNumber: s.order.number,
    orderStatus: s.order.status,
    status: s.status as ShipmentStatus,
    shipTo: { name: a.name, city: a.city, state: a.state, pincode: a.pincode },
    paymentMethod: s.order.paymentMethod,
    promisedDate: s.promisedDate,
    items: s.items.map((i) => ({
      id: i.id,
      skuId: i.skuId,
      title: i.title,
      variant: i.variant,
      imageUrl: i.imageUrl,
      qty: i.qty,
      unitPricePaise: n(i.unitPricePaise),
      lineTotalPaise: n(i.lineTotalPaise),
    })),
    itemsPaise: s.items.reduce((sum, i) => sum + n(i.lineTotalPaise), 0),
    weightGrams: s.weightGrams,
    courier: s.courier,
    awb: s.awb,
    labelUrl: s.awb ? `/seller/shipments/${s.id}/label.pdf` : null,
    shippingCostPaise: s.shippingCostPaise === null ? null : n(s.shippingCostPaise),
    placedAt: s.order.placedAt.toISOString(),
    acceptedAt: s.acceptedAt?.toISOString() ?? null,
    packedAt: s.packedAt?.toISOString() ?? null,
    shippedAt: s.shippedAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
  };
}
