import type { CheckoutDescriptor, GatewayOrder } from './payment-provider';
import { RazorpayCompatibleProvider } from './razorpay-compatible.provider';

/** Razorpay, test mode only (keys must start with rzp_test_). Browser opens checkout.js. */
export class RazorpayProvider extends RazorpayCompatibleProvider {
  readonly name = 'razorpay' as const;

  checkout(order: GatewayOrder): CheckoutDescriptor {
    return {
      kind: 'razorpay',
      keyId: this.cfg.keyId,
      providerOrderId: order.providerOrderId,
      amountPaise: Number(order.amountPaise),
      currency: order.currency,
    };
  }
}
