import type { Metadata } from 'next';
import { Suspense } from 'react';
import { QueueStatus } from '@/components/queue/queue-status';

export const metadata: Metadata = { title: 'You are in the queue', robots: { index: false } };

/** M7.5 sale-day waiting room: shown when checkout answers WAITING_ROOM. */
export default function QueuePage() {
  return (
    <main className="mx-auto max-w-page px-3 py-10">
      <Suspense fallback={null}>
        <QueueStatus />
      </Suspense>
    </main>
  );
}
