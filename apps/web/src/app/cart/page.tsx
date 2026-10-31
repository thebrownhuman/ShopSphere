import type { Metadata } from 'next';
import { CartView } from '@/components/cart/cart-view';

export const metadata: Metadata = { title: 'Cart', robots: { index: false } };

export default function CartPage() {
  return (
    <main className="mx-auto max-w-page px-4 py-6">
      <CartView />
    </main>
  );
}
