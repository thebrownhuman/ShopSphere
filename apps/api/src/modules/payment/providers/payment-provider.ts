import type { ProviderName } from '../domain/payment.types';

export interface CreateGatewayOrderInput {
  amountPaise: bigint;
  currency: string;
  /** Our order id, echoed back by the gateway. */
  receipt: string;
  idempotencyKey: string;
}

export interface GatewayOrder {
  providerOrderId: string;
  amountPaise: bigint;
  currency: string;
}

export type GatewayPaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';

export interface GatewayPayment {
  providerPaymentId: string;
  providerOrderId: string;
  amountPaise: bigint;
  currency: string;
  status: GatewayPaymentStatus;
  method: string | null;
  errorReason: string | null;
}

export type NormalizedEvent =
  | {
      eventId: string;
      type: 'payment.authorized' | 'payment.captured' | 'payment.failed';
      payment: GatewayPayment;
    }
  | {
      eventId: string;
      type: 'refund.processed' | 'refund.failed';
      refund: { providerRefundId: string; providerPaymentId: string; amountPaise: bigint };
    }
  | { eventId: string; type: 'other'; rawType: string };

export interface GatewayRefund {
  providerRefundId: string;
  status: 'pending' | 'processed' | 'failed';
}

/** What the browser needs to open the gateway's hosted checkout. Card data never touches us. */
export type CheckoutDescriptor =
  | {
      kind: 'razorpay';
      keyId: string;
      providerOrderId: string;
      amountPaise: number;
      currency: string;
    }
  | { kind: 'redirect'; url: string };

export interface PaymentProvider {
  readonly name: ProviderName;
  createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder>;
  checkout(order: GatewayOrder, callbackUrl: string): CheckoutDescriptor;
  /** Verifies the signed browser redirect (order id | payment id). */
  verifySignature(input: {
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }): boolean;
  /** Verifies and normalises a webhook; throws AppError WEBHOOK_SIGNATURE_INVALID on tamper. */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): NormalizedEvent;
  capture(providerPaymentId: string, amountPaise: bigint, currency: string): Promise<void>;
  refund(
    providerPaymentId: string,
    amountPaise: bigint,
    idempotencyKey: string,
  ): Promise<GatewayRefund>;
  fetchStatus(providerOrderId: string): Promise<GatewayPayment[]>;
}
