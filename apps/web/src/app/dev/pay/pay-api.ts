import type { ApiError } from '@shopsphere/types';
import { API_URL, ApiRequestError } from '../../../lib/api';

export type ProviderName = 'razorpay' | 'bank';

export type Checkout =
  | {
      kind: 'razorpay';
      keyId: string;
      providerOrderId: string;
      amountPaise: number;
      currency: string;
    }
  | { kind: 'redirect'; url: string };

export interface InitiateResponse {
  paymentId: string;
  orderId: string;
  provider: ProviderName;
  providerOrderId: string;
  amountPaise: number;
  checkout: Checkout;
}

export interface PaymentStatus {
  orderId: string;
  state: 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED';
  attempts: {
    providerPaymentId: string;
    status: string;
    method: string | null;
    errorReason: string | null;
  }[];
  refunds: { id: string; amountPaise: number; reason: string; status: string }[];
}

async function send<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new ApiRequestError(res.status, json as ApiError | null);
  return json as T;
}

export const payApi = {
  providers: () => send<{ providers: ProviderName[] }>('GET', '/payments/providers'),
  createStubOrder: (amountPaise: number) =>
    send<{ orderId: string; amountPaise: number }>('POST', '/payments/dev/orders', { amountPaise }),
  initiate: (orderId: string, provider: ProviderName, returnUrl: string) =>
    send<InitiateResponse>(
      'POST',
      `/payments/${encodeURIComponent(orderId)}/initiate`,
      { provider, returnUrl },
      crypto.randomUUID(),
    ),
  verify: (
    orderId: string,
    body: {
      provider: ProviderName;
      providerOrderId: string;
      providerPaymentId: string;
      signature: string;
    },
  ) => send<PaymentStatus>('POST', `/payments/${encodeURIComponent(orderId)}/verify`, body),
  status: (orderId: string) =>
    send<PaymentStatus>('GET', `/payments/${encodeURIComponent(orderId)}/status`),
};
