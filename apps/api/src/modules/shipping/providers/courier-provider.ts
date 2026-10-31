import type { CourierTrackingStatus, CourierWebhookEvent, DeliveryZone } from '@shopsphere/types';

/**
 * 3PL adapter (M5.6). courier-sim implements it today; Shiprocket/Delhivery adapters map their
 * own APIs and webhook formats onto these shapes. Money is integer paise.
 */
export interface CourierProvider {
  readonly name: string;
  rate(input: RateInput): Promise<RateQuote>;
  createShipment(input: CreateShipmentInput): Promise<BookedShipment>;
  label(awb: string): Promise<Buffer>;
  track(awb: string): Promise<TrackingSnapshot>;
  /** Lane/SLA matrix for delivery estimates (M5.6a). */
  serviceability(): Promise<ServiceabilityMatrix>;
  /**
   * Verifies and parses a webhook. Returns null when the signature is invalid.
   * `rawBody` is the exact bytes received.
   */
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): CourierWebhookEvent | null;
}

export interface RateInput {
  fromPincode: string;
  toPincode: string;
  weightGrams: number;
  cod: boolean;
}

export type RateQuote =
  | { serviceable: false }
  | { serviceable: true; zone: DeliveryZone; slaDays: number; ratePaise: number };

export interface CreateShipmentInput extends RateInput {
  /** Our shipment id: the courier must treat it as an idempotency key. */
  reference: string;
  codAmountPaise: number;
  sender: string;
  consignee: { name: string; city: string; state: string };
}

export interface BookedShipment {
  awb: string;
  ratePaise: number;
  slaDays: number;
}

export interface TrackingSnapshot {
  awb: string;
  events: {
    eventId: string;
    status: CourierTrackingStatus;
    sequence: number;
    location: string | null;
    occurredAt: string;
  }[];
}

/** Same rules courier-sim evaluates (apps/courier-sim/src/lanes.ts). */
export interface ServiceabilityMatrix {
  version: string;
  metroPrefixes: string[];
  remotePatterns: string[];
  unserviceablePatterns: string[];
  slaDays: Record<DeliveryZone, number>;
}

export class CourierError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
