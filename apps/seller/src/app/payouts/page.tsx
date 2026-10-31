'use client';

import type {
  SellerPayout,
  SellerPayoutDetail,
  SellerPayoutsPage,
  SellerStatement,
  SettlementBreakdown,
} from '@shopsphere/types';
import { Button, formatPaise, SectionCard } from '@shopsphere/ui';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Field } from '@/components/field';
import { api, ApiCallError } from '@/lib/api';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const BREAKDOWN: [keyof SettlementBreakdown, string][] = [
  ['grossPaise', 'Gross sales'],
  ['commissionPaise', 'Commission'],
  ['shippingFeePaise', 'Shipping fee'],
  ['feesGstPaise', 'GST on fees'],
  ['tcsPaise', 'TCS (1%)'],
  ['tdsPaise', 'TDS (0.1%)'],
  ['netPaise', 'Net payable'],
];

/** Payouts and settlement statements (M5.7 data, read-only). */
export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<SellerPayout[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<SellerPayoutDetail | null>(null);
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDay(new Date()));
  const [statement, setStatement] = useState<SellerStatement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiCallError ? err.message : fallback);

  const load = useCallback(async (after?: string) => {
    try {
      const params = new URLSearchParams({ limit: '20', ...(after ? { cursor: after } : {}) });
      const page = await api<SellerPayoutsPage>(`/seller/payouts?${params}`);
      setPayouts((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (err) {
      fail(err, 'Could not load payouts');
    }
  }, []);

  const loadStatement = useCallback(async (f: string, t: string) => {
    try {
      setStatement(await api<SellerStatement>(`/seller/statements?from=${f}&to=${t}`));
    } catch (err) {
      fail(err, 'Could not load the statement');
    }
  }, []);

  useEffect(() => {
    void load();
    void loadStatement(from, to);
    // Initial load only; the statement form reloads on submit.
  }, []);

  async function toggle(p: SellerPayout) {
    if (open?.id === p.id) return setOpen(null);
    try {
      setOpen(await api<SellerPayoutDetail>(`/seller/payouts/${p.id}`));
    } catch (err) {
      fail(err, 'Could not load payout');
    }
  }

  const submitStatement = (e: FormEvent) => {
    e.preventDefault();
    void loadStatement(from, to);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Payouts</h1>
      {error && <Alert>{error}</Alert>}

      <SectionCard title="Statement">
        <form onSubmit={submitStatement} className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
        {statement && (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {BREAKDOWN.map(([k, label]) => (
                <div key={k} className="rounded bg-slate-50 p-2">
                  <dt className="text-slate-600">{label}</dt>
                  <dd className="font-semibold">{formatPaise(statement.totals[k])}</dd>
                </div>
              ))}
              <div className="rounded bg-slate-50 p-2">
                <dt className="text-slate-600">Paid out</dt>
                <dd className="font-semibold" data-testid="paid-out">
                  {formatPaise(statement.paidOutPaise)}
                </dd>
              </div>
              <div className="rounded bg-slate-50 p-2">
                <dt className="text-slate-600">Pending</dt>
                <dd className="font-semibold">{formatPaise(statement.pendingPaise)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              {statement.lines.length} delivered shipment(s). Payouts run T+7 after delivery.
            </p>
          </>
        )}
      </SectionCard>

      <SectionCard title="Payout history">
        {payouts.length === 0 ? (
          <p className="text-sm text-slate-600">No payouts yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="p-2">Date</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Status</th>
                <th className="p-2">UTR</th>
                <th className="p-2">Shipments</th>
                <th className="p-2">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="p-2">{(p.paidAt ?? p.createdAt).slice(0, 10)}</td>
                  <td className="p-2 font-medium">{formatPaise(p.amountPaise)}</td>
                  <td className="p-2">{p.status}</td>
                  <td className="p-2 font-mono text-xs">{p.utr ?? '—'}</td>
                  <td className="p-2">
                    {p.lineCount}
                    {open?.id === p.id && (
                      <ul className="mt-1 text-xs">
                        {open.lines.map((l) => (
                          <li key={l.id}>
                            {l.orderNumber}: {formatPaise(l.netPaise)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => void toggle(p)}
                    >
                      {open?.id === p.id ? 'Hide' : 'Details'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cursor && (
          <Button variant="secondary" className="mt-3" onClick={() => void load(cursor)}>
            Load more
          </Button>
        )}
      </SectionCard>
    </div>
  );
}
