import { Injectable } from '@nestjs/common';

/**
 * PAYMENT_FAILED = the payment window closed unpaid: no new payments may start, but a capture
 * that still arrives is kept (the orders module re-reserves stock or cancels and refunds).
 */
export type PayableOrderStatus = 'PENDING_PAYMENT' | 'PAYMENT_FAILED' | 'CONFIRMED' | 'CANCELLED';

export interface PayableOrder {
  orderId: string;
  /** Owner; initiate requires this user's access token when set. */
  userId?: string;
  amountPaise: bigint;
  currency: 'INR';
  status: PayableOrderStatus;
}

/**
 * What payments needs from orders. Implemented over the orders tables by
 * order/order-payable.source.ts; StubOrderSource backs the payment unit tests.
 */
export interface PayableOrderSource {
  getPayableOrder(orderId: string): Promise<PayableOrder | null>;
}

export const PAYABLE_ORDER_SOURCE = Symbol('PAYABLE_ORDER_SOURCE');

/** In-memory stand-in for unit tests. */
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
