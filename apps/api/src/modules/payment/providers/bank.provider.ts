import type { CheckoutDescriptor, GatewayOrder } from './payment-provider';
import {
  RazorpayCompatibleConfig,
  RazorpayCompatibleProvider,
} from './razorpay-compatible.provider';

/** ShopSphere Bank (apps/bank-sim): full-page redirect to the bank-hosted checkout. */
export class BankProvider extends RazorpayCompatibleProvider {
  readonly name = 'bank' as const;

  constructor(
    cfg: RazorpayCompatibleConfig,
    private readonly checkoutUrl: string,
  ) {
    super(cfg);
  }

  checkout(order: GatewayOrder, callbackUrl: string): CheckoutDescriptor {
    const url = new URL(this.checkoutUrl);
    url.searchParams.set('order_id', order.providerOrderId);
    url.searchParams.set('key_id', this.cfg.keyId);
    url.searchParams.set('callback_url', callbackUrl);
    return { kind: 'redirect', url: url.toString() };
  }
}
