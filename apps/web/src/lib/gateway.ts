import type { GatewayCheckout } from './api/checkout.types';

/**
 * Opens the payment gateway's hosted checkout. Card / UPI / bank details are only ever entered
 * there (ShopSphere Bank's hosted page or Razorpay Checkout), never on ShopSphere pages.
 * Either way the browser ends on /checkout/result, which polls the server for the webhook outcome.
 */

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  handler: (r: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (opts: RazorpayOptions) => { open: () => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Razorpay checkout'));
    document.body.appendChild(s);
  });
}

export function resultUrl(orderId: string, provider: 'bank' | 'razorpay'): string {
  return `${window.location.origin}/checkout/result?${new URLSearchParams({ orderId, provider })}`;
}

export async function openGateway(
  checkout: GatewayCheckout,
  orderId: string,
  onDismiss: () => void,
): Promise<void> {
  if (checkout.kind === 'redirect') {
    window.location.assign(checkout.url);
    return;
  }
  await loadRazorpay();
  new window.Razorpay!({
    key: checkout.keyId,
    order_id: checkout.providerOrderId,
    amount: checkout.amountPaise,
    currency: checkout.currency,
    name: 'ShopSphere (test mode)',
    handler: (r) => {
      const q = new URLSearchParams({
        orderId,
        provider: 'razorpay',
        order_id: r.razorpay_order_id,
        payment_id: r.razorpay_payment_id,
        signature: r.razorpay_signature,
      });
      window.location.assign(`/checkout/result?${q}`);
    },
    modal: { ondismiss: onDismiss },
  }).open();
}
