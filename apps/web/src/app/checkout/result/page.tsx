import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrderResult } from '@/components/checkout/order-result';

export const metadata: Metadata = { title: 'Order status', robots: { index: false } };

/** M4.25: gateway return page → confirmation / payment pending / payment failed + retry. */
export default function CheckoutResultPage() {
  return (
    <main className="mx-auto max-w-page px-3 py-8">
      <Suspense fallback={null}>
        <OrderResult />
      </Suspense>
    </main>
  );
}
