'use client';

import type { AdminOrderDetail } from '@shopsphere/types';
import { Button, formatPaise, SectionCard } from '@shopsphere/ui';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Field } from '@/components/field';
import { StatusPill, Table } from '@/components/table';
import { useAdmin } from '@/lib/admin-context';
import { api, rupeesToPaise } from '@/lib/api';
import { attempt, useLoad } from '@/lib/use-load';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAdmin();
  const { data: o, error, reload } = useLoad<AdminOrderDetail>(`/admin/orders/${id}`);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <Alert>{error}</Alert>;
  if (!o) return <p className="text-slate-600">Loading…</p>;
  const refundable = o.capturedPaise - o.refundedPaise;

  const refund = async (e: FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(amount);
    if (!paise || paise > refundable) {
      setMsg({ tone: 'error', text: `Enter an amount up to ${formatPaise(refundable)}` });
      return;
    }
    if (!window.confirm(`Refund ${formatPaise(paise)} to the customer?`)) return;
    setBusy(true);
    const err = await attempt(() =>
      api(`/admin/orders/${o.id}/refunds`, { method: 'POST', json: { amountPaise: paise, note } }),
    );
    setBusy(false);
    setMsg(err ? { tone: 'error', text: err } : { tone: 'ok', text: 'Refund submitted' });
    if (!err) {
      setAmount('');
      setNote('');
    }
    await reload();
  };

  return (
    <div className="space-y-4">
      <SectionCard title={`Order ${o.number}`} action={<StatusPill status={o.status} />}>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Customer</dt>
            <dd>
              {o.customer.name ?? '—'} · {o.customer.email ?? o.customer.phone ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Payment</dt>
            <dd>
              {o.paymentMethod} · total {formatPaise(o.totalPaise)}
              {o.couponCode ? ` · coupon ${o.couponCode}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Captured / refunded</dt>
            <dd data-testid="refund-totals">
              {formatPaise(o.capturedPaise)} / {formatPaise(o.refundedPaise)}
            </dd>
          </div>
        </dl>
      </SectionCard>
      <SectionCard title="Items">
        <Table
          label="Items"
          head={['Item', 'Qty', 'Unit price']}
          rows={o.items.map((i, k) => ({
            key: String(k),
            cells: [i.title, i.qty, formatPaise(i.unitPricePaise)],
          }))}
        />
      </SectionCard>
      <SectionCard title="Refunds">
        <Table
          label="Refunds"
          empty="No refunds."
          head={['When', 'Amount', 'Reason', 'Status']}
          rows={o.refunds.map((r) => ({
            key: r.id,
            cells: [
              new Date(r.createdAt).toLocaleString('en-IN'),
              formatPaise(r.amountPaise),
              r.reason,
              <StatusPill key="s" status={r.status} />,
            ],
          }))}
        />
        {can('FINANCE') && refundable > 0 && (
          <form
            onSubmit={refund}
            className="mt-4 grid max-w-xl gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
          >
            <Field
              label="Refund amount (₹)"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={`Up to ${formatPaise(refundable)}`}
            />
            <Field
              label="Note (kept in the audit log)"
              required
              minLength={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Refund
            </Button>
          </form>
        )}
        {msg && (
          <div className="mt-3">
            <Alert tone={msg.tone}>{msg.text}</Alert>
          </div>
        )}
      </SectionCard>
      <SectionCard title="Timeline">
        <ol className="space-y-1 text-sm">
          {o.events.map((e, k) => (
            <li key={k}>
              {new Date(e.createdAt).toLocaleString('en-IN')} — {e.toStatus} ({e.actor})
            </li>
          ))}
        </ol>
      </SectionCard>
    </div>
  );
}
