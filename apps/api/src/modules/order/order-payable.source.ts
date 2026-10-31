import { Injectable } from '@nestjs/common';
import type { PayableOrder, PayableOrderSource } from '../payment/orders/payable-order-source';
import { PrismaService } from '../shared/prisma/prisma.service';
import { payableStatus } from './order-state';
import { isUuid } from './order.service';

/**
 * What the payment module sees of an order: the online amount (total − store balance) and a
 * coarse status. A window that has closed reads as PAYMENT_FAILED even before the expiry sweep
 * runs, so no new gateway order is created for it; a capture that still arrives is kept and
 * handled as a late capture (M4.34). Depends only on Prisma, so PaymentModule can use it
 * without importing OrderModule (which itself depends on PaymentModule).
 */
@Injectable()
export class OrderPayableSource implements PayableOrderSource {
  constructor(private readonly prisma: PrismaService) {}

  async getPayableOrder(orderId: string): Promise<PayableOrder | null> {
    if (!isUuid(orderId)) return null;
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        payablePaise: true,
        paymentMethod: true,
        payBy: true,
      },
    });
    if (!o) return null;
    let status = payableStatus(o.status as never);
    if (
      status === 'PENDING_PAYMENT' &&
      (o.paymentMethod !== 'ONLINE' || !o.payBy || o.payBy < new Date())
    ) {
      status = o.paymentMethod === 'ONLINE' ? 'PAYMENT_FAILED' : 'CONFIRMED';
    }
    return {
      orderId: o.id,
      userId: o.userId,
      amountPaise: o.payablePaise,
      currency: 'INR',
      status,
    };
  }
}
