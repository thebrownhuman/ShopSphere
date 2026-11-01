'use client';

import type { WaitingRoomStatus } from '@shopsphere/types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useRequester } from '@/lib/use-requester';

/** Only same-site checkout paths are valid targets (no open redirect through ?next=). */
export function safeNext(next: string | null): string {
  return next && /^\/checkout(\?|$)/.test(next) ? next : '/checkout';
}

/**
 * Polls GET /waiting-room/status (each poll may admit the shopper) and returns to checkout once
 * admitted. The pass lasts 15 minutes, so the rest of checkout is never queued again.
 */
export function QueueStatus() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const { request, ready, needsSignIn } = useRequester();
  const [status, setStatus] = useState<WaitingRoomStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (needsSignIn) router.replace(`/signin?next=${encodeURIComponent(next)}`);
  }, [needsSignIn, next, router]);

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const s = await request<WaitingRoomStatus>('/waiting-room/status');
        if (stopped) return;
        setStatus(s);
        setError(false);
        if (s.admitted) return router.replace(next);
        timer = setTimeout(poll, Math.min(10, Math.max(2, s.retryAfterSeconds)) * 1000);
      } catch {
        if (stopped) return;
        setError(true);
        timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [ready, request, next, router]);

  return (
    <section
      aria-labelledby="queue-title"
      className="mx-auto max-w-md rounded bg-white p-6 text-center shadow-sm"
    >
      <h1 id="queue-title" className="text-xl font-semibold text-slate-900">
        High demand right now
      </h1>
      <p className="mt-2 text-sm text-slate-700">
        To keep the sale fair, shoppers enter checkout in the order they arrived. Keep this page
        open and we&apos;ll take you to checkout automatically.
      </p>
      <div className="mt-6" role="status" aria-live="polite">
        {status && !status.admitted ? (
          <>
            <p className="text-4xl font-bold text-slate-900" data-testid="queue-position">
              {status.position.toLocaleString('en-IN')}
            </p>
            <p className="text-sm text-slate-700">
              {status.position === 1 ? 'shopper' : 'shoppers'} ahead of you
            </p>
          </>
        ) : status?.admitted ? (
          <p className="text-sm text-slate-900">It&apos;s your turn. Taking you to checkout…</p>
        ) : (
          <p className="text-sm text-slate-700">Checking your place in line…</p>
        )}
        {error && (
          <p className="mt-3 text-sm text-slate-700">Reconnecting… your place in line is kept.</p>
        )}
      </div>
    </section>
  );
}
