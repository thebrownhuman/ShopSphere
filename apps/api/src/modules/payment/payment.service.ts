import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors/app-error';
import { MetricsService } from '../shared/metrics/metrics.service';
import {
  AttemptStatus,
  EventOutcome,
  OrderPaymentState,
  ProviderName,
  RECONCILE_WINDOW_MS,
  RefundReason,
  RETRY_WINDOW_MS,
} from './domain/payment.types';
import { PAYABLE_ORDER_SOURCE, PayableOrderSource } from './orders/payable-order-source';
import type { GatewayPayment, NormalizedEvent } from './providers/payment-provider';
import { ProviderRegistry } from './providers/provider.registry';
import {
  AttemptRecord,
  PAYMENT_REPOSITORY,
  PaymentRecord,
  PaymentRepository,
  PaymentTx,
  RefundRecord,
} from './repository/payment.repository';

type Headers = Record<string, string | string[] | undefined>;
type PaymentEvent = Extract<NormalizedEvent, { payment: GatewayPayment }>;

interface ApplyResult {
  outcome: EventOutcome;
  refundIds: string[];
}

/** Attempt states after which money has moved and later failure events are stale. */
const SETTLED: AttemptStatus[] = [
  'CAPTURED',
  'DUPLICATE_CAPTURE',
  'AMOUNT_MISMATCH',
  'REFUND_ON_CAPTURE',
];

/** Provider order ids of test-toggle payments; reconciliation never polls a gateway for them. */
const SIMULATED_PREFIX = 'sim_';

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === 'P2002';

/** JSON-safe copy (bigint -> number; paise fit in a safe integer). */
const jsonSafe = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v)));

/**
 * Payment lifecycle (PRD section 9). Invariants:
 * - An order is paid only on a signature-verified webhook (or reconciliation fetch), never on redirect.
 * - Every gateway event is applied at most once (webhook_events unique per provider+event id).
 * - First capture wins per order; any later capture is refunded automatically.
 * - Money state changes and their outbox events commit in one transaction, serialised per order.
 */
@Injectable()
export class PaymentService {
  private readonly log = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository,
    private readonly providers: ProviderRegistry,
    @Inject(PAYABLE_ORDER_SOURCE) private readonly orders: PayableOrderSource,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async initiate(
    orderId: string,
    providerName: string,
    idempotencyKey: string,
    callbackUrl: string,
    callerUserId?: string,
  ) {
    const order = await this.orders.getPayableOrder(orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    if (order.userId !== undefined) {
      if (!callerUserId)
        throw new AppError('UNAUTHORIZED', 'Sign in required', HttpStatus.UNAUTHORIZED);
      if (callerUserId !== order.userId) {
        throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
      }
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw new AppError('ORDER_NOT_PAYABLE', `Order is ${order.status}`, HttpStatus.CONFLICT);
    }
    if (await this.repo.getOrderCapture(orderId)) {
      throw new AppError('ORDER_ALREADY_PAID', 'Order is already paid', HttpStatus.CONFLICT);
    }
    const provider = this.providers.get(providerName);

    // Reuse a fresh, unpaid gateway order for the same provider (user reopened checkout).
    const now = Date.now();
    let payment = (await this.repo.listPaymentsByOrder(orderId)).find(
      (p) =>
        p.provider === provider.name &&
        p.status === 'CREATED' &&
        p.amount === order.amountPaise &&
        now - p.createdAt.getTime() < RETRY_WINDOW_MS,
    );
    if (!payment) {
      const gatewayOrder = await provider.createOrder({
        amountPaise: order.amountPaise,
        currency: order.currency,
        receipt: orderId,
        idempotencyKey: `${orderId}:${provider.name}:${idempotencyKey}`,
      });
      if (gatewayOrder.amountPaise !== order.amountPaise) {
        throw new AppError(
          'PROVIDER_AMOUNT_MISMATCH',
          'Gateway order amount does not match',
          HttpStatus.BAD_GATEWAY,
        );
      }
      payment = await this.repo.createPayment({
        orderId,
        provider: provider.name,
        providerOrderId: gatewayOrder.providerOrderId,
        amount: order.amountPaise,
        currency: order.currency,
        status: 'CREATED',
      });
    }
    return {
      paymentId: payment.id,
      orderId,
      provider: provider.name,
      providerOrderId: payment.providerOrderId,
      amountPaise: Number(payment.amount),
      currency: payment.currency,
      checkout: provider.checkout(
        {
          providerOrderId: payment.providerOrderId,
          amountPaise: payment.amount,
          currency: payment.currency,
        },
        callbackUrl,
      ),
    };
  }

  /**
   * Browser return (`/checkout/result`): verifies the redirect HMAC and marks the payment PENDING.
   * Does not mark the order paid; that waits for the webhook.
   */
  async verifyReturn(
    orderId: string,
    input: {
      provider: string;
      providerOrderId: string;
      providerPaymentId: string;
      signature: string;
    },
  ) {
    const provider = this.providers.get(input.provider);
    if (!provider.verifySignature(input)) {
      throw new AppError('SIGNATURE_INVALID', 'Payment signature verification failed');
    }
    const payment = (await this.repo.listPaymentsByOrder(orderId)).find(
      (p) => p.provider === provider.name && p.providerOrderId === input.providerOrderId,
    );
    if (!payment) {
      throw new AppError(
        'PAYMENT_NOT_FOUND',
        'No such payment for this order',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.withUniqueRetry(() =>
      this.repo.transaction(async (tx) => {
        await tx.lockOrder(orderId);
        const attempt = await tx.findAttempt(provider.name, input.providerPaymentId);
        if (!attempt) {
          await tx.createAttempt({
            paymentId: payment.id,
            orderId,
            provider: provider.name,
            providerPaymentId: input.providerPaymentId,
            amount: payment.amount,
            currency: payment.currency,
            method: null,
            status: 'AUTHORIZED',
            errorReason: null,
          });
        }
        const current = await tx.findPaymentByProviderOrder(provider.name, input.providerOrderId);
        if (current && (current.status === 'CREATED' || current.status === 'FAILED')) {
          await tx.updatePaymentStatus(current.id, 'PENDING');
        }
      }),
    );
    return this.status(orderId);
  }

  async status(orderId: string) {
    const [payments, attempts, winner, refunds] = await Promise.all([
      this.repo.listPaymentsByOrder(orderId),
      this.repo.listAttemptsByOrder(orderId),
      this.repo.getOrderCapture(orderId),
      this.repo.listRefundsByOrder(orderId),
    ]);
    const state: OrderPaymentState = winner
      ? 'PAID'
      : payments.some((p) => p.status === 'PENDING')
        ? 'PENDING'
        : payments.some((p) => p.status === 'FAILED')
          ? 'FAILED'
          : 'UNPAID';
    return {
      orderId,
      state,
      winningAttemptId: winner,
      payments: payments.map(viewPayment),
      attempts: attempts.map(viewAttempt),
      refunds: refunds.map(viewRefund),
    };
  }

  async handleWebhook(providerName: string, rawBody: Buffer | undefined, headers: Headers) {
    const provider = this.providers.get(providerName);
    if (!rawBody?.length) throw new AppError('WEBHOOK_MALFORMED', 'Empty webhook body');
    const event = provider.verifyWebhook(rawBody, headers);
    const payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    const { outcome } = await this.applyEvent(provider.name, event, payload);
    this.metrics?.paymentOutcomes.inc({ provider: provider.name, type: event.type, outcome });
    const createdAt = (payload as { created_at?: unknown }).created_at;
    if (typeof createdAt === 'number' && outcome !== 'DUPLICATE_EVENT') {
      this.metrics?.webhookLag.observe(
        { provider: provider.name },
        Math.max(0, Date.now() / 1000 - createdAt),
      );
    }
    return { eventId: event.eventId, outcome };
  }

  /** Refund against the order's winning capture (partial allowed; total capped at captured amount). */
  async requestRefund(
    orderId: string,
    amountPaise: bigint,
    reason: RefundReason = 'CUSTOMER_REQUEST',
  ) {
    const refund = await this.repo.transaction(async (tx) => {
      await tx.lockOrder(orderId);
      const winner = await tx.getOrderCapture(orderId);
      const attempt = winner ? await this.repo.findAttemptById(winner) : null;
      if (!attempt) {
        throw new AppError('NOT_CAPTURED', 'Order has no captured payment', HttpStatus.CONFLICT);
      }
      const refunded = await tx.refundedAmount(attempt.id);
      if (refunded + amountPaise > attempt.amount) {
        throw new AppError(
          'REFUND_EXCEEDS_CAPTURE',
          'Refund exceeds the captured amount',
          HttpStatus.UNPROCESSABLE_ENTITY,
          { capturedPaise: Number(attempt.amount), refundedPaise: Number(refunded) },
        );
      }
      return this.createRefund(tx, attempt, amountPaise, reason);
    });
    await this.executeRefund(refund.id);
    const latest = await this.repo.findRefund(refund.id);
    return viewRefund(latest ?? refund);
  }

  /** Sends a PENDING refund to the gateway. Failures stay PENDING and are retried by reconcile(). */
  async executeRefund(refundId: string): Promise<void> {
    const refund = await this.repo.findRefund(refundId);
    if (!refund || refund.status !== 'PENDING') return;
    const attempt = await this.repo.findAttemptById(refund.attemptId);
    if (!attempt) return;
    try {
      const res = await this.providers
        .get(refund.provider)
        .refund(attempt.providerPaymentId, refund.amount, `refund_${refund.id}`);
      await this.repo.updateRefund(refund.id, {
        status:
          res.status === 'processed'
            ? 'PROCESSED'
            : res.status === 'failed'
              ? 'FAILED'
              : 'SUBMITTED',
        providerRefundId: res.providerRefundId,
        lastError: null,
      });
    } catch (err) {
      this.log.warn(`refund ${refund.id} not sent: ${(err as Error).message}`);
      await this.repo.updateRefund(refund.id, {
        status: 'PENDING',
        lastError: (err as Error).message,
      });
    }
  }

  /**
   * Reconciliation (M4.17), run every 5 min by apps/workers: polls the gateway for open payments
   * created in the last 24 h, applies what it finds through the webhook path (so it is idempotent
   * with real webhooks), captures authorized-but-uncaptured payments, expires stale ones and
   * retries refunds the gateway has not accepted yet.
   */
  async reconcile(now = new Date()) {
    const summary = {
      checked: 0,
      applied: 0,
      captureRequested: 0,
      expired: 0,
      refundsRetried: 0,
      errors: 0,
    };
    const windowStart = new Date(now.getTime() - RECONCILE_WINDOW_MS);

    for (const payment of await this.repo.listOpenPayments(windowStart)) {
      if (payment.providerOrderId.startsWith(SIMULATED_PREFIX)) continue;
      summary.checked += 1;
      try {
        const provider = this.providers.get(payment.provider);
        for (const gp of await provider.fetchStatus(payment.providerOrderId)) {
          const type =
            gp.status === 'captured'
              ? 'payment.captured'
              : gp.status === 'failed'
                ? 'payment.failed'
                : gp.status === 'authorized'
                  ? 'payment.authorized'
                  : null;
          if (!type) continue;
          const event: PaymentEvent = {
            eventId: `recon:${gp.providerPaymentId}:${gp.status}`,
            type,
            payment: gp,
          };
          const { outcome } = await this.applyEvent(payment.provider, event, {
            source: 'reconciliation',
            payment: jsonSafe(gp),
          });
          if (outcome !== 'DUPLICATE_EVENT') summary.applied += 1;
          if (
            gp.status === 'authorized' &&
            gp.amountPaise === payment.amount &&
            !(await this.repo.getOrderCapture(payment.orderId))
          ) {
            await provider.capture(gp.providerPaymentId, gp.amountPaise, gp.currency);
            summary.captureRequested += 1;
          }
        }
      } catch (err) {
        summary.errors += 1;
        this.log.warn(`reconcile ${payment.id} failed: ${(err as Error).message}`);
      }
    }
    summary.expired = await this.repo.expireStalePayments(windowStart);
    for (const refund of await this.repo.listRefundsByStatus('PENDING')) {
      await this.executeRefund(refund.id);
      summary.refundsRetried += 1;
    }
    return summary;
  }

  /**
   * M4.36 staging/QA toggle: records a gateway payment that never touched a gateway and applies
   * the requested outcome through the normal event path (so outbox, first-capture-wins and the
   * order transitions behave exactly as for a real webhook). Disabled in production by config.
   */
  async simulate(orderId: string, outcome: 'success' | 'failure' | 'pending') {
    const order = await this.orders.getPayableOrder(orderId);
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    const id = randomUUID().replace(/-/g, '').slice(0, 14);
    const payment = await this.repo.createPayment({
      orderId,
      provider: 'bank',
      providerOrderId: `${SIMULATED_PREFIX}order_${id}`,
      amount: order.amountPaise,
      currency: order.currency,
      status: 'CREATED',
    });
    const status =
      outcome === 'success' ? 'captured' : outcome === 'failure' ? 'failed' : 'authorized';
    const gp: GatewayPayment = {
      providerPaymentId: `${SIMULATED_PREFIX}pay_${id}`,
      providerOrderId: payment.providerOrderId,
      amountPaise: order.amountPaise,
      currency: order.currency,
      status,
      method: 'test',
      errorReason: outcome === 'failure' ? 'Simulated failure (test toggle)' : null,
    };
    const event: PaymentEvent = {
      eventId: `sim:${gp.providerPaymentId}:${status}`,
      type: `payment.${status}` as PaymentEvent['type'],
      payment: gp,
    };
    const result = await this.applyEvent('bank', event, {
      source: 'test-toggle',
      payment: jsonSafe(gp),
    });
    return {
      paymentId: payment.id,
      providerPaymentId: gp.providerPaymentId,
      outcome: result.outcome,
    };
  }

  private async applyEvent(provider: ProviderName, event: NormalizedEvent, payload: unknown) {
    const result = await this.withUniqueRetry(() =>
      this.repo.transaction<ApplyResult>(async (tx) => {
        const eventType = event.type === 'other' ? event.rawType : event.type;
        if (!(await tx.recordWebhookEvent(provider, event.eventId, eventType, payload))) {
          return { outcome: 'DUPLICATE_EVENT', refundIds: [] };
        }
        const applied = await this.applyInTx(tx, provider, event);
        await tx.setWebhookOutcome(provider, event.eventId, applied.outcome);
        return applied;
      }),
    );
    // Refunds go to the gateway after commit; reconcile() retries any that fail here.
    for (const id of result.refundIds) await this.executeRefund(id);
    return result;
  }

  private async applyInTx(
    tx: PaymentTx,
    provider: ProviderName,
    event: NormalizedEvent,
  ): Promise<ApplyResult> {
    if (event.type === 'refund.processed' || event.type === 'refund.failed') {
      const found = await tx.updateRefundByProviderId(
        event.refund.providerRefundId,
        event.type === 'refund.processed' ? 'PROCESSED' : 'FAILED',
      );
      return { outcome: found ? 'REFUND_UPDATED' : 'IGNORED_STALE', refundIds: [] };
    }
    if (event.type === 'other') return { outcome: 'IGNORED_TYPE', refundIds: [] };

    const gp = (event as PaymentEvent).payment;
    const payment = await tx.findPaymentByProviderOrder(provider, gp.providerOrderId);
    if (!payment) return { outcome: 'UNKNOWN_ORDER', refundIds: [] };
    await tx.lockOrder(payment.orderId);

    const attempt =
      (await tx.findAttempt(provider, gp.providerPaymentId)) ??
      (await tx.createAttempt({
        paymentId: payment.id,
        orderId: payment.orderId,
        provider,
        providerPaymentId: gp.providerPaymentId,
        amount: gp.amountPaise,
        currency: gp.currency,
        method: gp.method,
        status: 'AUTHORIZED',
        errorReason: null,
      }));
    const none: string[] = [];

    if (event.type === 'payment.authorized') {
      if (attempt.status !== 'AUTHORIZED') return { outcome: 'IGNORED_STALE', refundIds: none };
      if (payment.status === 'CREATED' || payment.status === 'FAILED') {
        await tx.updatePaymentStatus(payment.id, 'PENDING');
      }
      return { outcome: 'AUTHORIZED', refundIds: none };
    }

    if (event.type === 'payment.failed') {
      // Out-of-order: a failure arriving after capture never undoes the capture.
      if (SETTLED.includes(attempt.status)) return { outcome: 'IGNORED_STALE', refundIds: none };
      if (attempt.status === 'FAILED') return { outcome: 'ALREADY_APPLIED', refundIds: none };
      await tx.updateAttempt(attempt.id, {
        status: 'FAILED',
        method: gp.method,
        errorReason: gp.errorReason,
      });
      if (payment.status === 'CREATED' || payment.status === 'PENDING') {
        await tx.updatePaymentStatus(payment.id, 'FAILED');
      }
      await tx.enqueueOutbox({
        aggregateType: 'payment',
        aggregateId: payment.orderId,
        eventType: 'payment.failed',
        payload: {
          orderId: payment.orderId,
          paymentId: payment.id,
          provider,
          providerPaymentId: gp.providerPaymentId,
          reason: gp.errorReason,
        },
      });
      return { outcome: 'FAILED', refundIds: none };
    }

    // payment.captured (a FAILED attempt may still capture late).
    if (SETTLED.includes(attempt.status)) return { outcome: 'ALREADY_APPLIED', refundIds: none };
    await tx.updateAttempt(attempt.id, { method: gp.method ?? attempt.method });

    if (gp.amountPaise !== payment.amount || gp.currency !== payment.currency) {
      await tx.updateAttempt(attempt.id, { status: 'AMOUNT_MISMATCH' });
      const refund = await this.createRefund(
        tx,
        { ...attempt, amount: gp.amountPaise },
        gp.amountPaise,
        'AMOUNT_MISMATCH',
      );
      await this.emit(tx, 'payment.amount_mismatch', payment, attempt, {
        capturedPaise: Number(gp.amountPaise),
      });
      return { outcome: 'AMOUNT_MISMATCH', refundIds: [refund.id] };
    }

    const order = await this.orders.getPayableOrder(payment.orderId);
    if (order?.status === 'CANCELLED' || payment.status === 'EXPIRED') {
      await tx.updateAttempt(attempt.id, { status: 'REFUND_ON_CAPTURE' });
      const reason: RefundReason =
        order?.status === 'CANCELLED' ? 'ORDER_CANCELLED' : 'PAYMENT_EXPIRED';
      const refund = await this.createRefund(tx, attempt, gp.amountPaise, reason);
      await this.emit(tx, 'payment.refund_on_capture', payment, attempt, { reason });
      return { outcome: 'CAPTURED_REFUNDED', refundIds: [refund.id] };
    }

    if (await tx.claimOrderCapture(payment.orderId, attempt.id)) {
      await tx.updateAttempt(attempt.id, { status: 'CAPTURED' });
      await tx.updatePaymentStatus(payment.id, 'CAPTURED');
      await this.emit(tx, 'payment.captured', payment, attempt, {
        amountPaise: Number(gp.amountPaise),
        method: gp.method,
      });
      return { outcome: 'CAPTURED', refundIds: none };
    }

    // First capture wins: this one is a duplicate charge for an already-paid order.
    await tx.updateAttempt(attempt.id, { status: 'DUPLICATE_CAPTURE' });
    if (payment.status !== 'CAPTURED') await tx.updatePaymentStatus(payment.id, 'DUPLICATE');
    const refund = await this.createRefund(tx, attempt, gp.amountPaise, 'DUPLICATE_CAPTURE');
    await this.emit(tx, 'payment.duplicate_captured', payment, attempt, {
      winningAttemptId: await tx.getOrderCapture(payment.orderId),
    });
    return { outcome: 'DUPLICATE_REFUNDED', refundIds: [refund.id] };
  }

  private async createRefund(
    tx: PaymentTx,
    attempt: AttemptRecord,
    amount: bigint,
    reason: RefundReason,
  ) {
    const refund = await tx.createRefund({
      attemptId: attempt.id,
      orderId: attempt.orderId,
      provider: attempt.provider,
      amount,
      reason,
    });
    await tx.enqueueOutbox({
      aggregateType: 'payment',
      aggregateId: attempt.orderId,
      eventType: 'payment.refund_requested',
      payload: {
        orderId: attempt.orderId,
        refundId: refund.id,
        attemptId: attempt.id,
        amountPaise: Number(amount),
        reason,
      },
    });
    return refund;
  }

  private emit(
    tx: PaymentTx,
    eventType: string,
    payment: PaymentRecord,
    attempt: AttemptRecord,
    extra: Record<string, unknown>,
  ) {
    return tx.enqueueOutbox({
      aggregateType: 'payment',
      aggregateId: payment.orderId,
      eventType,
      payload: jsonSafe({
        orderId: payment.orderId,
        paymentId: payment.id,
        attemptId: attempt.id,
        provider: payment.provider,
        providerPaymentId: attempt.providerPaymentId,
        ...extra,
      }) as Prisma.InputJsonValue,
    });
  }

  /** Concurrent first-sight inserts of the same attempt abort one transaction; replay it once. */
  private async withUniqueRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return fn();
    }
  }
}

function viewPayment(p: PaymentRecord) {
  return {
    id: p.id,
    provider: p.provider,
    providerOrderId: p.providerOrderId,
    amountPaise: Number(p.amount),
    currency: p.currency,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

function viewAttempt(a: AttemptRecord) {
  return {
    id: a.id,
    paymentId: a.paymentId,
    provider: a.provider,
    providerPaymentId: a.providerPaymentId,
    amountPaise: Number(a.amount),
    method: a.method,
    status: a.status,
    errorReason: a.errorReason,
  };
}

function viewRefund(r: RefundRecord) {
  return {
    id: r.id,
    attemptId: r.attemptId,
    providerRefundId: r.providerRefundId,
    amountPaise: Number(r.amount),
    reason: r.reason,
    status: r.status,
  };
}
