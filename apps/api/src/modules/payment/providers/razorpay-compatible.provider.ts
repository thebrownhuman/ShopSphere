import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error';
import type { ProviderName } from '../domain/payment.types';
import type {
  CheckoutDescriptor,
  CreateGatewayOrderInput,
  GatewayOrder,
  GatewayPayment,
  GatewayPaymentStatus,
  GatewayRefund,
  NormalizedEvent,
  PaymentProvider,
} from './payment-provider';
import { hmacSha256Hex, signaturesMatch } from './signature';

export interface RazorpayCompatibleConfig {
  apiBaseUrl: string;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  signatureHeader: string;
  eventIdHeader: string;
}

interface WirePayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: GatewayPaymentStatus;
  method?: string | null;
  error_description?: string | null;
}

interface WireRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
}

interface WireWebhook {
  event: string;
  payload?: { payment?: { entity: WirePayment }; refund?: { entity: WireRefund } };
}

type Headers = Record<string, string | string[] | undefined>;

const header = (headers: Headers, name: string) => {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Shared adapter for gateways that speak Razorpay's API: Razorpay itself (test mode) and the
 * ShopSphere Bank simulator, which deliberately mirrors it (orders, hosted checkout, HMAC
 * redirect signature over "order_id|payment_id", HMAC webhook over the raw body).
 */
export abstract class RazorpayCompatibleProvider implements PaymentProvider {
  abstract readonly name: ProviderName;

  constructor(protected readonly cfg: RazorpayCompatibleConfig) {}

  abstract checkout(order: GatewayOrder, callbackUrl: string): CheckoutDescriptor;

  async createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder> {
    const body = await this.call<{ id: string; amount: number; currency: string }>(
      'POST',
      '/orders',
      {
        amount: Number(input.amountPaise),
        currency: input.currency,
        receipt: input.receipt.slice(0, 40),
        notes: { shop_order_id: input.receipt },
      },
      input.idempotencyKey,
    );
    return { providerOrderId: body.id, amountPaise: BigInt(body.amount), currency: body.currency };
  }

  verifySignature(input: {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }): boolean {
    const expected = hmacSha256Hex(
      this.cfg.keySecret,
      `${input.providerOrderId}|${input.providerPaymentId}`,
    );
    return signaturesMatch(expected, input.signature);
  }

  verifyWebhook(rawBody: Buffer, headers: Headers): NormalizedEvent {
    const expected = hmacSha256Hex(this.cfg.webhookSecret, rawBody);
    if (!signaturesMatch(expected, header(headers, this.cfg.signatureHeader))) {
      throw new AppError(
        'WEBHOOK_SIGNATURE_INVALID',
        'Webhook signature verification failed',
        HttpStatus.UNAUTHORIZED,
      );
    }
    let body: WireWebhook;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as WireWebhook;
    } catch {
      throw new AppError('WEBHOOK_MALFORMED', 'Webhook body is not JSON');
    }
    const eventId =
      header(headers, this.cfg.eventIdHeader) ?? createHash('sha256').update(rawBody).digest('hex');

    const p = body.payload?.payment?.entity;
    if (
      p &&
      (body.event === 'payment.captured' ||
        body.event === 'payment.failed' ||
        body.event === 'payment.authorized')
    ) {
      return { eventId, type: body.event, payment: toGatewayPayment(p) };
    }
    const r = body.payload?.refund?.entity;
    if (r && (body.event === 'refund.processed' || body.event === 'refund.failed')) {
      return {
        eventId,
        type: body.event,
        refund: {
          providerRefundId: r.id,
          providerPaymentId: r.payment_id,
          amountPaise: BigInt(r.amount),
        },
      };
    }
    return { eventId, type: 'other', rawType: String(body.event) };
  }

  async capture(providerPaymentId: string, amountPaise: bigint, currency: string): Promise<void> {
    await this.call('POST', `/payments/${encodeURIComponent(providerPaymentId)}/capture`, {
      amount: Number(amountPaise),
      currency,
    });
  }

  async refund(
    providerPaymentId: string,
    amountPaise: bigint,
    idempotencyKey: string,
  ): Promise<GatewayRefund> {
    const body = await this.call<WireRefund>(
      'POST',
      `/payments/${encodeURIComponent(providerPaymentId)}/refund`,
      { amount: Number(amountPaise), receipt: idempotencyKey.slice(0, 40) },
      idempotencyKey,
    );
    return { providerRefundId: body.id, status: body.status };
  }

  async fetchStatus(providerOrderId: string): Promise<GatewayPayment[]> {
    const body = await this.call<{ items: WirePayment[] }>(
      'GET',
      `/orders/${encodeURIComponent(providerOrderId)}/payments`,
    );
    return body.items.map(toGatewayPayment);
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const auth = Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64');
    let res: Response;
    try {
      res = await fetch(`${this.cfg.apiBaseUrl}${path}`, {
        method,
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/json',
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new AppError(
        'PROVIDER_UNREACHABLE',
        `${this.name} is unreachable`,
        HttpStatus.BAD_GATEWAY,
        {
          reason: (err as Error).message,
        },
      );
    }
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      throw new AppError(
        'PROVIDER_ERROR',
        `${this.name} rejected the request`,
        HttpStatus.BAD_GATEWAY,
        {
          status: res.status,
          body: json,
        },
      );
    }
    return json as T;
  }
}

function toGatewayPayment(p: WirePayment): GatewayPayment {
  return {
    providerPaymentId: p.id,
    providerOrderId: p.order_id,
    amountPaise: BigInt(p.amount),
    currency: p.currency,
    status: p.status,
    method: p.method ?? null,
    errorReason: p.error_description ?? null,
  };
}
