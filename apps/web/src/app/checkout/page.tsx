import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

/** Placeholder until checkout lands in M4. */
export default function CheckoutPage() {
  return (
    <main className="mx-auto max-w-page px-4 py-10">
      <div className="bg-white p-6">
        <h1 className="mb-2 text-2xl font-bold">Checkout is coming soon</h1>
        <Link href="/cart" className="text-brand-dark hover:underline">
          Back to cart
        </Link>
      </div>
    </main>
  );
}
