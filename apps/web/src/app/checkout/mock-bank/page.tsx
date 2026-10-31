import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CHECKOUT_MOCK } from '@/lib/api/checkout';
import { MockBank } from './mock-bank';

/** Stand-in for the bank-sim hosted checkout; exists only with NEXT_PUBLIC_CHECKOUT_MOCK=1. */
export default function MockBankPage() {
  if (!CHECKOUT_MOCK) notFound();
  return (
    <main className="mx-auto max-w-md px-3 py-8">
      <Suspense fallback={null}>
        <MockBank />
      </Suspense>
    </main>
  );
}
