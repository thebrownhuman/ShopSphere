import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { Behaviour } from './cards';
import { config } from './config';

/** Wire shapes deliberately mirror Razorpay's (snake_case, amounts in paise, unix seconds). */
export interface BankOrder {
  id: string;
  entity: 'order';
  amount: number;
  amount_paid: number;
  currency: string;
  receipt: string | null;
  notes: Record<string, string>;
  status: 'created' | 'attempted' | 'paid';
  attempts: number;
  created_at: number;
}

export interface BankPayment {
  id: string;
  entity: 'payment';
  order_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';
  method: 'card' | 'netbanking' | 'upi';
  captured: boolean;
  amount_refunded: number;
  description: string | null;
  card: { last4: string; network: string; type: string } | null;
  bank: string | null;
  vpa: string | null;
  error_code: string | null;
  error_description: string | null;
  created_at: number;
}

export interface BankRefund {
  id: string;
  entity: 'refund';
  payment_id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: 'processed';
  created_at: number;
}

export interface WebhookDelivery {
  eventId: string;
  event: string;
  body: string;
  attempts: number;
  lastStatus: number | null;
  delivered: boolean;
  createdAt: Date;
}

export class BankError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const id = (prefix: string) => `${prefix}_${randomBytes(7).toString('hex')}`;
const now = () => Math.floor(Date.now() / 1000);
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

export type PaymentDetails = Pick<BankPayment, 'method' | 'card' | 'bank' | 'vpa'>;

/** In-memory bank ledger. State resets on restart (it is a simulator). */
@Injectable()
export class BankService implements OnModuleDestroy {
  private readonly log = new Logger(BankService.name);
  readonly orders = new Map<string, BankOrder>();
  readonly payments = new Map<string, BankPayment>();
  readonly refunds = new Map<string, BankRefund>();
  readonly deliveries: WebhookDelivery[] = [];
  private readonly idempotency = new Map<string, string>();
  private readonly timers = new Set<NodeJS.Timeout>();
  /** Set false in tests to keep webhooks in memory only. */
  sendWebhooks = true;

  onModuleDestroy() {
    this.timers.forEach(clearTimeout);
  }

  createOrder(
    input: { amount?: unknown; currency?: unknown; receipt?: unknown; notes?: unknown },
    idemKey?: string,
  ) {
    if (idemKey) {
      const existing = this.idempotency.get(`order:${idemKey}`);
      if (existing) return this.orders.get(existing)!;
    }
    if (!Number.isInteger(input.amount) || (input.amount as number) < 100) {
      throw new BankError(400, 'amount must be an integer number of paise >= 100');
    }
    if ((input.currency ?? 'INR') !== 'INR') throw new BankError(400, 'only INR is supported');
    const order: BankOrder = {
      id: id('order'),
      entity: 'order',
      amount: input.amount as number,
      amount_paid: 0,
      currency: 'INR',
      receipt: typeof input.receipt === 'string' ? input.receipt.slice(0, 40) : null,
      notes: (input.notes as Record<string, string>) ?? {},
      status: 'created',
      attempts: 0,
      created_at: now(),
    };
    this.orders.set(order.id, order);
    if (idemKey) this.idempotency.set(`order:${idemKey}`, order.id);
    return order;
  }

  getOrder(orderId: string): BankOrder {
    const order = this.orders.get(orderId);
    if (!order) throw new BankError(404, 'order not found');
    return order;
  }

  getPayment(paymentId: string): BankPayment {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new BankError(404, 'payment not found');
    return payment;
  }

  paymentsForOrder(orderId: string): BankPayment[] {
    return [...this.payments.values()].filter((p) => p.order_id === orderId);
  }

  /** HMAC the shopper's browser carries back: hex(HMAC_SHA256(key_secret, order_id|payment_id)). */
  sign(orderId: string, paymentId: string): string {
    return createHmac('sha256', config.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  }

  /** Runs a shopper payment with the chosen test behaviour; returns the payment to redirect with. */
  pay(
    orderId: string,
    details: PaymentDetails,
    behaviour: Behaviour,
    failReason?: string,
  ): BankPayment {
    const order = this.getOrder(orderId);
    if (order.status === 'paid' && behaviour !== 'duplicate')
      throw new BankError(409, 'order already paid');
    order.attempts += 1;
    if (order.status === 'created') order.status = 'attempted';
    const payment = this.newPayment(order, details);

    switch (behaviour) {
      case 'success':
        this.capture(payment);
        break;
      case 'fail':
        this.fail(payment, failReason ?? 'Payment declined by issuer');
        break;
      case 'pending':
        // Money not yet confirmed (e.g. UPI collect not approved). Resolved from /dev or never.
        break;
      case 'authorize':
        payment.status = 'authorized';
        this.emit('payment.authorized', payment);
        break;
      case 'late':
        payment.status = 'authorized';
        this.later(() => this.capture(payment), config.lateCaptureDelayMs);
        break;
      case 'duplicate':
        this.capture(payment);
        // Simulates the shopper being charged twice (e.g. retried in another tab).
        this.later(() => this.capture(this.newPayment(order, details)), 1_500);
        break;
    }
    return payment;
  }

  /** Merchant capture of an authorized payment (also used by /dev resolve). */
  merchantCapture(paymentId: string, amount: unknown): BankPayment {
    const payment = this.getPayment(paymentId);
    if (payment.status === 'captured') throw new BankError(400, 'payment already captured');
    if (payment.status !== 'authorized' && payment.status !== 'created') {
      throw new BankError(400, `payment is ${payment.status}`);
    }
    if (amount !== payment.amount)
      throw new BankError(400, 'capture amount must equal the authorized amount');
    this.capture(payment);
    return payment;
  }

  resolvePending(paymentId: string, outcome: 'capture' | 'fail'): BankPayment {
    const payment = this.getPayment(paymentId);
    if (payment.status !== 'created' && payment.status !== 'authorized') {
      throw new BankError(400, `payment is ${payment.status}`);
    }
    if (outcome === 'capture') this.capture(payment);
    else this.fail(payment, 'Payment request expired');
    return payment;
  }

  refund(
    paymentId: string,
    input: { amount?: unknown; receipt?: unknown },
    idemKey?: string,
  ): BankRefund {
    if (idemKey) {
      const existing = this.idempotency.get(`refund:${idemKey}`);
      if (existing) return this.refunds.get(existing)!;
    }
    const payment = this.getPayment(paymentId);
    if (!payment.captured) throw new BankError(400, 'payment is not captured');
    const amount =
      input.amount === undefined ? payment.amount - payment.amount_refunded : input.amount;
    if (!Number.isInteger(amount) || (amount as number) <= 0)
      throw new BankError(400, 'invalid refund amount');
    if ((amount as number) + payment.amount_refunded > payment.amount) {
      throw new BankError(400, 'refund amount exceeds the captured amount');
    }
    const refund: BankRefund = {
      id: id('rfnd'),
      entity: 'refund',
      payment_id: payment.id,
      amount: amount as number,
      currency: payment.currency,
      receipt: typeof input.receipt === 'string' ? input.receipt : null,
      status: 'processed',
      created_at: now(),
    };
    this.refunds.set(refund.id, refund);
    if (idemKey) this.idempotency.set(`refund:${idemKey}`, refund.id);
    payment.amount_refunded += refund.amount;
    if (payment.amount_refunded === payment.amount) payment.status = 'refunded';
    this.later(
      () =>
        this.send('refund.processed', { refund: { entity: refund }, payment: { entity: payment } }),
      500,
    );
    return refund;
  }

  /** Re-sends a past webhook with the same event id (lets you test receiver idempotency). */
  replay(eventId: string): WebhookDelivery {
    const delivery = this.deliveries.find((d) => d.eventId === eventId);
    if (!delivery) throw new BankError(404, 'delivery not found');
    void this.deliver(delivery, 0);
    return delivery;
  }

  private newPayment(order: BankOrder, details: PaymentDetails): BankPayment {
    const payment: BankPayment = {
      id: id('pay'),
      entity: 'payment',
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      status: 'created',
      captured: false,
      amount_refunded: 0,
      description: null,
      error_code: null,
      error_description: null,
      created_at: now(),
      ...details,
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  private capture(payment: BankPayment) {
    if (payment.captured) return;
    payment.status = 'captured';
    payment.captured = true;
    const order = this.orders.get(payment.order_id)!;
    order.status = 'paid';
    order.amount_paid += payment.amount;
    this.emit('payment.captured', payment);
  }

  private fail(payment: BankPayment, reason: string) {
    payment.status = 'failed';
    payment.error_code = 'BAD_REQUEST_ERROR';
    payment.error_description = reason;
    this.emit('payment.failed', payment);
  }

  private emit(event: string, payment: BankPayment) {
    this.send(event, { payment: { entity: { ...payment } } });
  }

  private send(event: string, payload: Record<string, unknown>) {
    const delivery: WebhookDelivery = {
      eventId: id('evt'),
      event,
      body: JSON.stringify({
        entity: 'event',
        event,
        contains: Object.keys(payload),
        payload,
        created_at: now(),
      }),
      attempts: 0,
      lastStatus: null,
      delivered: false,
      createdAt: new Date(),
    };
    this.deliveries.unshift(delivery);
    if (this.deliveries.length > 200) this.deliveries.pop();
    void this.deliver(delivery, 0);
  }

  private async deliver(delivery: WebhookDelivery, attempt: number): Promise<void> {
    if (!this.sendWebhooks) return;
    delivery.attempts += 1;
    const signature = createHmac('sha256', config.webhookSecret)
      .update(delivery.body)
      .digest('hex');
    try {
      const res = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bank-signature': signature,
          'x-bank-event-id': delivery.eventId,
        },
        body: delivery.body,
        signal: AbortSignal.timeout(10_000),
      });
      delivery.lastStatus = res.status;
      delivery.delivered = res.ok;
      if (res.ok) return;
    } catch (err) {
      delivery.lastStatus = null;
      this.log.warn(`webhook ${delivery.eventId} failed: ${(err as Error).message}`);
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) this.later(() => void this.deliver(delivery, attempt + 1), delay);
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
}
