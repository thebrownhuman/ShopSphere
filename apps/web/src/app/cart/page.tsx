import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Cart', robots: { index: false } };

/** Placeholder until the cart lands in M3. */
export default function CartPage() {
  return (
    <main className="mx-auto max-w-page px-4 py-10">
      <div className="bg-white p-6">
        <h1 className="mb-2 text-2xl font-bold">Your ShopSphere Cart is empty</h1>
        <Link href="/" className="text-brand-dark hover:underline">
          Continue shopping
        </Link>
      </div>
    </main>
  );
}
