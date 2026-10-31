import type { Metadata } from 'next';
import { OrderDetailView } from '@/components/orders/order-detail';

export const metadata: Metadata = { title: 'Order details', robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-page px-3 py-6">
      <OrderDetailView id={id} />
    </main>
  );
}
