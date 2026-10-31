/**
 * Fulfilment, shipping and settlement API contract (M5.5–M5.7). Money is integer paise,
 * timestamps ISO 8601 UTC. Keep changes additive.
 *
 * Seller routes need `Authorization: Bearer <access token>` of a user with an APPROVED seller
 * account (seller_accounts, M5.1); otherwise 403 SELLER_NOT_APPROVED. Other sellers' shipments answer 404.
 *
 *   GET  /seller/orders?status=&cursor=&limit=       -> SellerOrdersPage   (queue, one row per shipment)
 *   POST /seller/orders/:shipmentId/accept            -> SellerShipment
 *   POST /seller/orders/:shipmentId/pack  PackRequest -> SellerShipment
 *   POST /seller/orders/:shipmentId/label             -> SellerShipment     (books courier, AWB + label)
 *   GET  /seller/shipments/:shipmentId                -> SellerShipmentDetail (tracking timeline)
 *   GET  /seller/shipments/:shipmentId/label.pdf      -> application/pdf
 *   GET  /seller/payouts?cursor=&limit=               -> SellerPayoutsPage
 *   GET  /seller/payouts/:payoutId                    -> SellerPayoutDetail
 *   GET  /seller/statements?from=YYYY-MM-DD&to=YYYY-MM-DD -> SellerStatement
 *
 * Courier webhooks: POST /shipping/webhooks/:provider (HMAC-signed, see CourierWebhookEvent).
 */

import type { Paise } from './index';
import type { ShipmentStatus } from './order';

/** Statuses a courier reports. */
export type CourierTrackingStatus = 'SHIPPED' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

export interface SellerShipmentItem {
  id: string;
  skuId: string;
  title: string;
  variant: string | null;
  imageUrl: string | null;
  qty: number;
  unitPricePaise: Paise;
  lineTotalPaise: Paise;
}

export interface SellerShipment {
  id: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  status: ShipmentStatus;
  /** Buyer name, city, state, pincode only: no phone/street for the seller list view. */
  shipTo: { name: string; city: string; state: string; pincode: string };
  paymentMethod: string;
  promisedDate: string;
  items: SellerShipmentItem[];
  itemsPaise: Paise;
  weightGrams: number | null;
  courier: string | null;
  awb: string | null;
  /** Relative API path to the label PDF once LABEL_CREATED. */
  labelUrl: string | null;
  shippingCostPaise: Paise | null;
  placedAt: string;
  acceptedAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface SellerOrdersPage {
  items: SellerShipment[];
  nextCursor: string | null;
}

export interface PackRequest {
  /** Packed weight; defaults to 500 g per unit. */
  weightGrams?: number;
}

export interface TrackingEvent {
  status: CourierTrackingStatus;
  location: string | null;
  occurredAt: string;
  /** False when the event arrived out of order or duplicated and changed nothing. */
  applied: boolean;
}

export interface SellerShipmentDetail extends SellerShipment {
  tracking: TrackingEvent[];
}

/** Body the courier (courier-sim) posts to /shipping/webhooks/:provider. */
export interface CourierWebhookEvent {
  /** Unique per event; replays are ignored. */
  eventId: string;
  awb: string;
  /** Our shipment id, echoed back from createShipment. */
  reference: string;
  status: CourierTrackingStatus;
  /** Monotonic per AWB. */
  sequence: number;
  location: string | null;
  occurredAt: string;
}

// ───────── Settlement (M5.7) ─────────

export type SettlementLineStatus = 'PENDING' | 'IN_PAYOUT' | 'PAID' | 'ON_HOLD';
export type PayoutStatus = 'PROCESSING' | 'PAID' | 'FAILED';

/** Per-shipment settlement once delivered. net = gross − all deductions. */
export interface SettlementBreakdown {
  /** Buyer-paid item value incl. GST. */
  grossPaise: Paise;
  /** Taxable value (excl. GST), base for TCS. */
  taxablePaise: Paise;
  commissionPaise: Paise;
  /** 18% GST on commission + shipping fee. */
  feesGstPaise: Paise;
  shippingFeePaise: Paise;
  /** §52 CGST: 1% of net taxable value. */
  tcsPaise: Paise;
  /** §194-O: 0.1% of gross. */
  tdsPaise: Paise;
  netPaise: Paise;
}

export interface SettlementLine extends SettlementBreakdown {
  id: string;
  shipmentId: string;
  orderNumber: string;
  status: SettlementLineStatus;
  deliveredAt: string;
  /** deliveredAt + 7 days. */
  eligibleAt: string;
  payoutId: string | null;
}

export interface SellerPayout {
  id: string;
  batchId: string;
  amountPaise: Paise;
  status: PayoutStatus;
  /** Bank reference (UTR) once paid. */
  utr: string | null;
  lineCount: number;
  createdAt: string;
  paidAt: string | null;
}

export interface SellerPayoutsPage {
  items: SellerPayout[];
  nextCursor: string | null;
}

export interface SellerPayoutDetail extends SellerPayout {
  lines: SettlementLine[];
}

export interface SellerStatement {
  from: string;
  to: string;
  lines: SettlementLine[];
  totals: SettlementBreakdown;
  paidOutPaise: Paise;
  pendingPaise: Paise;
}
