import { StubOrderSource } from './orders/payable-order-source';
import { loadPaymentConfig } from './payment.config';
import { PaymentService } from './payment.service';
import { BankProvider } from './providers/bank.provider';
import type { GatewayOrder, GatewayPayment } from './providers/payment-provider';
import { ProviderRegistry } from './providers/provider.registry';
import { hmacSha256Hex } from './providers/signature';
import { InMemoryPaymentRepository } from './testing/in-memory-payment.repository';

const KEY_SECRET = 'ssb_test_key_secret';
const WEBHOOK_SECRET = 'ssb_test_webhook_secret';

/** Real BankProvider crypto, fake network. */
class FakeBank extends BankProvider {
  orders = 0;
  refunds: { paymentId: string; amount: bigint; key: string }[] = [];
  gatewayPayments: GatewayPayment[] = [];
  captures: string[] = [];
  refundFails = false;

  constructor() {
    super(
      {
        apiBaseUrl: 'http://bank.invalid/v1',
        keyId: 'ssb_test_key_id',
        keySecret: KEY_SECRET,
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: 'x-bank-signature',
        eventIdHeader: 'x-bank-event-id',
      },
      'http://bank.invalid/checkout',
    );
  }
  async createOrder(input: { amountPaise: bigint; currency: string }): Promise<GatewayOrder> {
    this.orders += 1;
    return {
      providerOrderId: `order_${this.orders}`,
      amountPaise: input.amountPaise,
      currency: input.currency,
    };
  }
  async refund(paymentId: string, amount: bigint, key: string) {
    if (this.refundFails) throw new Error('bank down');
    this.refunds.push({ paymentId, amount, key });
    return { providerRefundId: `rfnd_${this.refunds.length}`, status: 'processed' as const };
  }
  async fetchStatus(providerOrderId: string) {
    return this.gatewayPayments.filter((p) => p.providerOrderId === providerOrderId);
  }
  async capture(paymentId: string) {
    this.captures.push(paymentId);
  }
}

function webhook(
  event: string,
  p: { id: string; orderId: string; amount?: number; status?: string },
  eventId: string,
  secret = WEBHOOK_SECRET,
) {
  const body = Buffer.from(
    JSON.stringify({
      event,
      payload: {
        payment: {
          entity: {
            id: p.id,
            order_id: p.orderId,
            amount: p.amount ?? 49_900,
            currency: 'INR',
            status: p.status ?? event.split('.')[1],
            method: 'card',
            error_description: event === 'payment.failed' ? 'Card declined' : null,
          },
        },
      },
    }),
  );
  return {
    body,
    headers: { 'x-bank-signature': hmacSha256Hex(secret, body), 'x-bank-event-id': eventId },
  };
}

describe('PaymentService', () => {
  let repo: InMemoryPaymentRepository;
  let bank: FakeBank;
  let orders: StubOrderSource;
  let svc: PaymentService;

  const send = (w: ReturnType<typeof webhook>) => svc.handleWebhook('bank', w.body, w.headers);
  const initiate = async (orderId = 'ord1', key = 'k1') =>
    svc.initiate(orderId, 'bank', key, 'http://localhost:3000/dev/pay/result');

  beforeEach(() => {
    repo = new InMemoryPaymentRepository();
    bank = new FakeBank();
    orders = new StubOrderSource();
    orders.register('ord1', 49_900n);
    const registry = new ProviderRegistry(loadPaymentConfig({}));
    registry.register(bank);
    svc = new PaymentService(repo, registry, orders);
  });

  describe('initiate', () => {
    it('creates a gateway order and a redirect checkout', async () => {
      const res = await initiate();
      expect(res).toMatchObject({
        provider: 'bank',
        providerOrderId: 'order_1',
        amountPaise: 49_900,
      });
      expect(res.checkout).toEqual({
        kind: 'redirect',
        url: expect.stringContaining('order_id=order_1'),
      });
    });

    it('reuses a fresh unpaid gateway order', async () => {
      await initiate('ord1', 'k1');
      const again = await initiate('ord1', 'k2');
      expect(again.providerOrderId).toBe('order_1');
      expect(bank.orders).toBe(1);
    });

    it('rejects unknown, unpayable and paid orders', async () => {
      await expect(initiate('nope')).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
      orders.register('cancelled', 100n, 'CANCELLED');
      await expect(initiate('cancelled')).rejects.toMatchObject({ code: 'ORDER_NOT_PAYABLE' });
      await initiate();
      await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1'));
      await expect(initiate('ord1', 'k9')).rejects.toMatchObject({ code: 'ORDER_ALREADY_PAID' });
    });
  });

  describe('signature checks', () => {
    it('verifies a genuine redirect and marks the payment pending, not paid', async () => {
      await initiate();
      const signature = hmacSha256Hex(KEY_SECRET, 'order_1|pay_1');
      const res = await svc.verifyReturn('ord1', {
        provider: 'bank',
        providerOrderId: 'order_1',
        providerPaymentId: 'pay_1',
        signature,
      });
      expect(res.state).toBe('PENDING');
    });

    it('rejects a tampered redirect signature', async () => {
      await initiate();
      const signature = hmacSha256Hex(KEY_SECRET, 'order_1|pay_1');
      await expect(
        svc.verifyReturn('ord1', {
          provider: 'bank',
          providerOrderId: 'order_1',
          providerPaymentId: 'pay_2',
          signature,
        }),
      ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
    });

    it('rejects a webhook whose body was altered after signing', async () => {
      await initiate();
      const w = webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1');
      const tampered = Buffer.from(w.body.toString().replace('49900', '100'));
      await expect(svc.handleWebhook('bank', tampered, w.headers)).rejects.toMatchObject({
        code: 'WEBHOOK_SIGNATURE_INVALID',
      });
      expect(repo.state.webhookEvents.size).toBe(0);
    });

    it('rejects a webhook signed with the wrong secret or unsigned', async () => {
      await initiate();
      const w = webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1', 'other');
      await expect(send(w)).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
      await expect(svc.handleWebhook('bank', w.body, {})).rejects.toMatchObject({
        code: 'WEBHOOK_SIGNATURE_INVALID',
      });
    });
  });

  describe('webhook processing', () => {
    beforeEach(() => initiate());

    it('captures once and publishes payment.captured via outbox', async () => {
      const res = await send(
        webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1'),
      );
      expect(res.outcome).toBe('CAPTURED');
      expect((await svc.status('ord1')).state).toBe('PAID');
      expect(repo.state.outbox.map((e) => e.eventType)).toEqual(['payment.captured']);
    });

    it('replayed webhook (same event id) is a no-op', async () => {
      const w = webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1');
      await send(w);
      expect((await send(w)).outcome).toBe('DUPLICATE_EVENT');
      expect(repo.state.outbox).toHaveLength(1);
    });

    it('same payment captured under a new event id is not applied twice', async () => {
      await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1'));
      const res = await send(
        webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e2'),
      );
      expect(res.outcome).toBe('ALREADY_APPLIED');
      expect(repo.state.refunds).toHaveLength(0);
    });

    it('failure arriving after capture (out of order) does not undo it', async () => {
      await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1'));
      const res = await send(webhook('payment.failed', { id: 'pay_1', orderId: 'order_1' }, 'e0'));
      expect(res.outcome).toBe('IGNORED_STALE');
      const status = await svc.status('ord1');
      expect(status.state).toBe('PAID');
      expect(status.attempts[0].status).toBe('CAPTURED');
    });

    it('late capture after failure wins', async () => {
      expect(
        (await send(webhook('payment.failed', { id: 'pay_1', orderId: 'order_1' }, 'e1'))).outcome,
      ).toBe('FAILED');
      expect((await svc.status('ord1')).state).toBe('FAILED');
      expect(
        (await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e2')))
          .outcome,
      ).toBe('CAPTURED');
      expect((await svc.status('ord1')).state).toBe('PAID');
    });

    it('amount mismatch is never marked paid and is refunded', async () => {
      const res = await send(
        webhook('payment.captured', { id: 'pay_1', orderId: 'order_1', amount: 100 }, 'e1'),
      );
      expect(res.outcome).toBe('AMOUNT_MISMATCH');
      expect((await svc.status('ord1')).state).not.toBe('PAID');
      expect(bank.refunds).toEqual([{ paymentId: 'pay_1', amount: 100n, key: expect.any(String) }]);
    });

    it('unknown gateway order is recorded but changes nothing', async () => {
      const res = await send(
        webhook('payment.captured', { id: 'pay_9', orderId: 'order_x' }, 'e1'),
      );
      expect(res.outcome).toBe('UNKNOWN_ORDER');
      expect(repo.state.attempts).toHaveLength(0);
    });
  });

  describe('first capture wins', () => {
    it('second capture on another attempt is auto-refunded', async () => {
      await initiate();
      await send(webhook('payment.failed', { id: 'pay_1', orderId: 'order_1' }, 'e1'));
      // Retry with a different gateway order (another method), both end up captured.
      repo.state.payments[0].status = 'FAILED';
      const second = await svc.initiate('ord1', 'bank', 'k2', 'http://localhost:3000/r');
      expect(second.providerOrderId).toBe('order_2');

      expect(
        (await send(webhook('payment.captured', { id: 'pay_2', orderId: 'order_2' }, 'e2')))
          .outcome,
      ).toBe('CAPTURED');
      expect(
        (await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e3')))
          .outcome,
      ).toBe('DUPLICATE_REFUNDED');

      const status = await svc.status('ord1');
      expect(status.state).toBe('PAID');
      expect(status.attempts.find((a) => a.providerPaymentId === 'pay_1')?.status).toBe(
        'DUPLICATE_CAPTURE',
      );
      expect(status.refunds).toEqual([
        expect.objectContaining({
          reason: 'DUPLICATE_CAPTURE',
          amountPaise: 49_900,
          status: 'PROCESSED',
        }),
      ]);
      expect(bank.refunds.map((r) => r.paymentId)).toEqual(['pay_1']);
      expect(repo.state.outbox.map((e) => e.eventType)).toContain('payment.duplicate_captured');
    });

    it('two payments captured on the same gateway order: second refunded', async () => {
      await initiate();
      await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1'));
      expect(
        (await send(webhook('payment.captured', { id: 'pay_2', orderId: 'order_1' }, 'e2')))
          .outcome,
      ).toBe('DUPLICATE_REFUNDED');
      expect(repo.state.payments[0].status).toBe('CAPTURED');
    });

    it('capture on a cancelled order is refunded', async () => {
      await initiate();
      orders.register('ord1', 49_900n, 'CANCELLED');
      expect(
        (await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1')))
          .outcome,
      ).toBe('CAPTURED_REFUNDED');
      expect(bank.refunds).toHaveLength(1);
    });

    it('failed refund stays PENDING and reconciliation retries it', async () => {
      await initiate();
      await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1'));
      bank.refundFails = true;
      await send(webhook('payment.captured', { id: 'pay_2', orderId: 'order_1' }, 'e2'));
      expect(repo.state.refunds[0].status).toBe('PENDING');
      bank.refundFails = false;
      const summary = await svc.reconcile();
      expect(summary.refundsRetried).toBe(1);
      expect(repo.state.refunds[0].status).toBe('PROCESSED');
    });
  });

  describe('refund API', () => {
    beforeEach(async () => {
      await initiate();
      await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'e1'));
    });

    it('allows partial refunds up to the captured amount', async () => {
      expect(await svc.requestRefund('ord1', 20_000n)).toMatchObject({
        status: 'PROCESSED',
        amountPaise: 20_000,
      });
      await svc.requestRefund('ord1', 29_900n);
      await expect(svc.requestRefund('ord1', 1n)).rejects.toMatchObject({
        code: 'REFUND_EXCEEDS_CAPTURE',
      });
    });

    it('refuses refunds on unpaid orders', async () => {
      await expect(svc.requestRefund('other', 1n)).rejects.toMatchObject({ code: 'NOT_CAPTURED' });
    });
  });

  describe('reconcile', () => {
    it('applies a capture whose webhook was lost, idempotently', async () => {
      await initiate();
      bank.gatewayPayments.push({
        providerPaymentId: 'pay_1',
        providerOrderId: 'order_1',
        amountPaise: 49_900n,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
        errorReason: null,
      });
      expect(await svc.reconcile()).toMatchObject({ checked: 1, applied: 1 });
      expect((await svc.status('ord1')).state).toBe('PAID');
      // The webhook arriving afterwards does not double-apply.
      expect(
        (await send(webhook('payment.captured', { id: 'pay_1', orderId: 'order_1' }, 'late')))
          .outcome,
      ).toBe('ALREADY_APPLIED');
    });

    it('requests capture for authorized-but-uncaptured payments', async () => {
      await initiate();
      bank.gatewayPayments.push({
        providerPaymentId: 'pay_1',
        providerOrderId: 'order_1',
        amountPaise: 49_900n,
        currency: 'INR',
        status: 'authorized',
        method: 'card',
        errorReason: null,
      });
      expect(await svc.reconcile()).toMatchObject({ captureRequested: 1 });
      expect(bank.captures).toEqual(['pay_1']);
    });

    it('expires payments older than 24 h', async () => {
      await initiate();
      const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
      expect(await svc.reconcile(later)).toMatchObject({ expired: 1 });
      expect(repo.state.payments[0].status).toBe('EXPIRED');
    });
  });
});
