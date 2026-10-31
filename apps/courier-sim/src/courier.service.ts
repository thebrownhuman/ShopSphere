import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { config } from './config';
import { labelPdf } from './label';
import { isPincode, MATRIX, rateFor, serviceable, zoneFor, type Zone } from './lanes';

export type TrackingStatus = 'MANIFESTED' | Step;
type Step = 'SHIPPED' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
const STEPS: Step[] = ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
/** Next step after `status` (MANIFESTED → SHIPPED …), or undefined when delivered. */
const nextStep = (status: TrackingStatus): Step | undefined =>
  STEPS[status === 'MANIFESTED' ? 0 : STEPS.indexOf(status) + 1];
const LOCATIONS: Record<Step, string> = {
  SHIPPED: 'Origin hub',
  OUT_FOR_DELIVERY: 'Destination delivery centre',
  DELIVERED: 'Consignee address',
};

export interface CourierShipment {
  awb: string;
  reference: string;
  fromPincode: string;
  toPincode: string;
  consignee: { name: string; city: string; state: string };
  sender: string;
  weightGrams: number;
  cod: boolean;
  codAmountPaise: number;
  zone: Zone;
  slaDays: number;
  ratePaise: number;
  status: TrackingStatus;
  sequence: number;
  events: {
    eventId: string;
    status: TrackingStatus;
    sequence: number;
    location: string;
    occurredAt: string;
  }[];
  createdAt: string;
}

export interface WebhookDelivery {
  eventId: string;
  awb: string;
  body: string;
  attempts: number;
  lastStatus: number | null;
  delivered: boolean;
}

export class CourierError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

/** In-memory 3PL. State resets on restart (it is a simulator). */
@Injectable()
export class CourierService implements OnModuleDestroy {
  private readonly log = new Logger(CourierService.name);
  readonly shipments = new Map<string, CourierShipment>();
  private readonly byReference = new Map<string, string>();
  readonly deliveries: WebhookDelivery[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  /** Set false in tests to keep webhooks in memory only. */
  sendWebhooks = true;
  autoAdvance = config.autoAdvance;
  stepMs = config.stepMs;

  onModuleDestroy() {
    this.timers.forEach(clearTimeout);
  }

  matrix() {
    return MATRIX;
  }

  quote(input: {
    fromPincode?: unknown;
    toPincode?: unknown;
    weightGrams?: unknown;
    cod?: unknown;
  }) {
    const { fromPincode, toPincode } = input;
    if (!isPincode(fromPincode) || !isPincode(toPincode)) {
      throw new CourierError(400, 'fromPincode and toPincode must be 6-digit pincodes');
    }
    const weight = input.weightGrams ?? 500;
    if (!Number.isInteger(weight) || (weight as number) <= 0 || (weight as number) > 50_000) {
      throw new CourierError(400, 'weightGrams must be an integer 1..50000');
    }
    if (!serviceable(toPincode)) {
      return { serviceable: false as const, fromPincode, toPincode };
    }
    const zone = zoneFor(fromPincode, toPincode);
    return {
      serviceable: true as const,
      fromPincode,
      toPincode,
      zone,
      slaDays: MATRIX.slaDays[zone],
      weightGrams: weight as number,
      ratePaise: rateFor(zone, weight as number, input.cod === true),
    };
  }

  /** Books a shipment. Idempotent on `reference` (our shipment id). */
  create(input: Record<string, unknown>): CourierShipment {
    const reference = input.reference;
    if (typeof reference !== 'string' || reference.length < 1 || reference.length > 64) {
      throw new CourierError(400, 'reference is required');
    }
    const existing = this.byReference.get(reference);
    if (existing) return this.shipments.get(existing)!;
    const q = this.quote(input);
    if (!q.serviceable) throw new CourierError(422, `pincode ${q.toPincode} is not serviceable`);
    const c = (input.consignee ?? {}) as Record<string, unknown>;
    const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');
    const s: CourierShipment = {
      awb: `CS${Date.now().toString().slice(-8)}${randomBytes(2).toString('hex').toUpperCase()}`,
      reference,
      fromPincode: q.fromPincode,
      toPincode: q.toPincode,
      consignee: { name: str(c.name), city: str(c.city), state: str(c.state) },
      sender: str(input.sender),
      weightGrams: q.weightGrams,
      cod: input.cod === true,
      codAmountPaise: Number.isInteger(input.codAmountPaise) ? (input.codAmountPaise as number) : 0,
      zone: q.zone,
      slaDays: q.slaDays,
      ratePaise: q.ratePaise,
      status: 'MANIFESTED',
      sequence: 0,
      events: [],
      createdAt: new Date().toISOString(),
    };
    this.shipments.set(s.awb, s);
    this.byReference.set(reference, s.awb);
    if (this.autoAdvance) this.scheduleNext(s);
    return s;
  }

  get(awb: string): CourierShipment {
    const s = this.shipments.get(awb);
    if (!s) throw new CourierError(404, 'shipment not found');
    return s;
  }

  label(awb: string): Buffer {
    const s = this.get(awb);
    return labelPdf([
      { text: 'ShopSphere Courier (simulated)', size: 12 },
      { text: `AWB ${s.awb}`, size: 20 },
      { text: `Ref ${s.reference}`, size: 8 },
      { text: `From: ${s.sender} ${s.fromPincode}` },
      { text: `To: ${s.consignee.name}` },
      { text: `${s.consignee.city}, ${s.consignee.state} ${s.toPincode}`, size: 12 },
      { text: `Zone ${s.zone}  SLA ${s.slaDays}d  ${s.weightGrams} g` },
      {
        text: s.cod ? `COD collect Rs ${(s.codAmountPaise / 100).toFixed(2)}` : 'PREPAID',
        size: 14,
      },
    ]);
  }

  /** Moves a shipment one tracking step forward now (dev / tests). */
  advance(awb: string): CourierShipment {
    const s = this.get(awb);
    const next = nextStep(s.status);
    if (!next) throw new CourierError(409, `shipment already ${s.status}`);
    this.step(s, next);
    return s;
  }

  /** Re-sends every webhook already emitted for the AWB (duplicate-delivery testing). */
  replay(awb: string): number {
    const list = this.deliveries.filter((d) => d.awb === awb);
    list.forEach((d) => void this.deliver(d, RETRY_DELAYS_MS.length));
    return list.length;
  }

  private scheduleNext(s: CourierShipment) {
    const next = nextStep(s.status);
    if (!next) return;
    this.later(() => {
      // Manual advance() may have moved past this step meanwhile.
      if (nextStep(s.status) !== next) return this.scheduleNext(s);
      this.step(s, next);
      this.scheduleNext(s);
    }, this.stepMs);
  }

  private step(s: CourierShipment, status: Step) {
    s.status = status;
    s.sequence += 1;
    const event = {
      eventId: `evt_${randomBytes(8).toString('hex')}`,
      status,
      sequence: s.sequence,
      location: LOCATIONS[status],
      occurredAt: new Date().toISOString(),
    };
    s.events.push(event);
    const delivery: WebhookDelivery = {
      eventId: event.eventId,
      awb: s.awb,
      body: JSON.stringify({ ...event, awb: s.awb, reference: s.reference }),
      attempts: 0,
      lastStatus: null,
      delivered: false,
    };
    this.deliveries.unshift(delivery);
    if (this.deliveries.length > 500) this.deliveries.pop();
    void this.deliver(delivery, 0);
  }

  sign(body: string): string {
    return createHmac('sha256', config.webhookSecret).update(body).digest('hex');
  }

  private async deliver(d: WebhookDelivery, attempt: number): Promise<void> {
    if (!this.sendWebhooks) return;
    d.attempts += 1;
    try {
      const res = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-courier-signature': this.sign(d.body),
          'x-courier-event-id': d.eventId,
        },
        body: d.body,
        signal: AbortSignal.timeout(10_000),
      });
      d.lastStatus = res.status;
      d.delivered = res.ok;
      if (res.ok) return;
    } catch (err) {
      d.lastStatus = null;
      this.log.warn(`webhook ${d.eventId} failed: ${(err as Error).message}`);
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) this.later(() => void this.deliver(d, attempt + 1), delay);
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
}
