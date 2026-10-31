import { Inject, Injectable } from '@nestjs/common';
import { OrderPayableSource } from '../../order/order-payable.source';
import { PAYMENT_CONFIG, PaymentConfig } from '../payment.config';
import { PayableOrder, PayableOrderSource, StubOrderSource } from './payable-order-source';

/** Real orders, plus in-memory `dev_` orders for the gateway playground when dev routes are on. */
@Injectable()
export class DevAwareOrderSource implements PayableOrderSource {
  constructor(
    private readonly orders: OrderPayableSource,
    private readonly dev: StubOrderSource,
    @Inject(PAYMENT_CONFIG) private readonly cfg: PaymentConfig,
  ) {}

  getPayableOrder(orderId: string): Promise<PayableOrder | null> {
    if (orderId.startsWith('dev_')) {
      return this.cfg.devRoutes ? this.dev.getPayableOrder(orderId) : Promise.resolve(null);
    }
    return this.orders.getPayableOrder(orderId);
  }
}
