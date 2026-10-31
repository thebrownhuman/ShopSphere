import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CheckoutFlow } from '@/components/checkout/checkout-flow';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

/** M4.21: single-page checkout (Address → Payment → Review) under the stripped header. */
export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-page px-3 py-4">
      <Suspense fallback={null}>
        <CheckoutFlow />
      </Suspense>
    </main>
  );
}
