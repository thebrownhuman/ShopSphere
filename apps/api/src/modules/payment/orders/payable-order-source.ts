import { Injectable } from '@nestjs/common';

export type PayableOrderStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED';

export interface PayableOrder {
  orderId: string;
  amountPaise: bigint;
  currency: 'INR';
  status: PayableOrderStatus;
}

/**
 * What payments needs from orders. The orders module (M4) will implement this over its
 * own tables; until then StubOrderSource stands in so payments can be built standalone.
 */
export interface PayableOrderSource {
  getPayableOrder(orderId: string): Promise<PayableOrder | null>;
}

export const PAYABLE_ORDER_SOURCE = Symbol('PAYABLE_ORDER_SOURCE');

/** In-memory dev stub: orders are registered through POST /payments/dev/orders. Lost on restart. */
@Injectable()
export class StubOrderSource implements PayableOrderSource {
  private readonly orders = new Map<string, PayableOrder>();

  register(orderId: string, amountPaise: bigint, status: PayableOrderStatus = 'PENDING_PAYMENT') {
    const order: PayableOrder = { orderId, amountPaise, currency: 'INR', status };
    this.orders.set(orderId, order);
    return order;
  }

  async getPayableOrder(orderId: string): Promise<PayableOrder | null> {
    return this.orders.get(orderId) ?? null;
  }
}
