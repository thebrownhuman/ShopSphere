'use client';

import type { TicketCategory } from '@shopsphere/types';
import { Button } from '@shopsphere/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { ordersApi } from '@/lib/api/orders';
import { supportApi } from '@/lib/api/returns';
import { RequireAuth } from '@/lib/auth';
import { useRequester } from '@/lib/use-requester';

const CATEGORIES: { key: TicketCategory; label: string }[] = [
  { key: 'ORDER', label: 'An order' },
  { key: 'RETURN', label: 'A return or refund' },
  { key: 'PAYMENT', label: 'A payment' },
  { key: 'ACCOUNT', label: 'My account' },
  { key: 'OTHER', label: 'Something else' },
];

function ContactForm() {
  const params = useSearchParams();
  const { request, ready } = useRequester();
  const support = useMemo(() => supportApi(request), [request]);
  const orders = useMemo(() => ordersApi(request), [request]);
  const qc = useQueryClient();
  const { data: recent } = useQuery({
    queryKey: ['orders', 'support-picker'],
    queryFn: () => orders.list(),
    enabled: ready,
  });
  const { data: tickets } = useQuery({
    queryKey: ['support-tickets'],
    queryFn: () => support.tickets(),
    enabled: ready,
  });
  const [category, setCategory] = useState<TicketCategory>(
    params.get('orderId') ? 'RETURN' : 'ORDER',
  );
  const [orderId, setOrderId] = useState(params.get('orderId') ?? '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await support.create({
        category,
        orderId: orderId || undefined,
        subject,
        message,
      });
      setCreated(t.number);
      setSubject('');
      setMessage('');
      await qc.invalidateQueries({ queryKey: ['support-tickets'] });
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code === 'VALIDATION_FAILED'
          ? 'Add a subject (3+ characters) and a message (10+ characters).'
          : err instanceof ApiRequestError
            ? err.message
            : 'Could not send. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-2';
  return (
    <>
      <form onSubmit={submit} className="mb-6 space-y-3 rounded bg-white p-4 text-sm">
        <label className="block">
          What do you need help with?
          <select
            className={field}
            value={category}
            onChange={(e) => setCategory(e.target.value as TicketCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Order (optional)
          <select className={field} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">Not about a specific order</option>
            {recent?.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.number}
              </option>
            ))}
            {orderId && !recent?.orders.some((o) => o.id === orderId) && (
              <option value={orderId}>This order</option>
            )}
          </select>
        </label>
        <label className="block">
          Subject
          <input
            className={field}
            value={subject}
            maxLength={120}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="block">
          Message
          <textarea
            className={field}
            rows={5}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-deal">
            {error}
          </p>
        )}
        {created && (
          <p role="status" className="text-green-700">
            Ticket {created} created. We reply by email within 24 hours.
          </p>
        )}
        <Button type="submit" variant="buy" disabled={busy}>
          {busy ? 'Sending…' : 'Send to support'}
        </Button>
      </form>
      {tickets && tickets.items.length > 0 && (
        <section className="rounded bg-white p-4 text-sm">
          <h2 className="mb-2 font-bold">Your tickets</h2>
          <ul className="divide-y divide-slate-100">
            {tickets.items.map((t) => (
              <li key={t.id} className="flex justify-between gap-3 py-2">
                <span>
                  <b>{t.number}</b> · {t.subject}
                  {t.orderNumber && (
                    <>
                      {' · '}
                      <Link href={`/orders/${t.orderId}`} className="text-brand-dark underline">
                        {t.orderNumber}
                      </Link>
                    </>
                  )}
                </span>
                <span className="text-slate-600">{t.status.replace('_', ' ').toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Contact support (M6.8): ticket form linked to the shopper's orders. */
export default function ContactPage() {
  return (
    <RequireAuth returnTo="/help/contact">
      <main className="mx-auto max-w-3xl px-4 py-8">
        <nav aria-label="Breadcrumb" className="mb-3 text-sm">
          <Link href="/help" className="text-brand-dark hover:underline">
            Help centre
          </Link>{' '}
          › Contact us
        </nav>
        <h1 className="mb-4 text-2xl font-bold">Contact support</h1>
        <Suspense>
          <ContactForm />
        </Suspense>
      </main>
    </RequireAuth>
  );
}
