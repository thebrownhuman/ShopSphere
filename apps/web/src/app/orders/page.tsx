import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrdersList } from '@/components/orders/orders-list';

export const metadata: Metadata = { title: 'Your Orders', robots: { index: false } };

export default function OrdersPage() {
  return (
    <main className="mx-auto max-w-page px-3 py-6">
      <h1 className="mb-4 text-2xl font-bold">Your Orders</h1>
      <Suspense fallback={null}>
        <OrdersList />
      </Suspense>
    </main>
  );
}
