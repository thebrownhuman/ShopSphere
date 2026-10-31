'use client';

import type { SellerDashboard } from '@shopsphere/types';
import { formatPrice, SectionCard } from '@shopsphere/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/field';
import { api, ApiCallError } from '@/lib/api';
import { useSeller } from '@/lib/seller-context';

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded bg-white p-4">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-1 text-2xl font-bold" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

/** Seller dashboard (M5.8): sales, orders, returns, listings, payout summary. Read-only. */
export default function DashboardPage() {
  const { account } = useSeller();
  const [data, setData] = useState<SellerDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (account?.status !== 'APPROVED') return;
    api<SellerDashboard>('/seller/dashboard').then(setData, (err) =>
      setError(err instanceof ApiCallError ? err.message : 'Could not load the dashboard'),
    );
  }, [account]);

  if (account?.status !== 'APPROVED') return null;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-slate-600">Loading dashboard…</p>;

  const maxDay = Math.max(1, ...data.daily.map((d) => d.salesPaise));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Sales, last 30 days"
          value={formatPrice(data.sales.last30DaysPaise)}
          testId="sales-30d"
        />
        <Stat label="Units sold, last 30 days" value={String(data.sales.unitsLast30Days)} />
        <Stat label="Orders (all time)" value={String(data.orders.total)} />
        <Stat
          label="Active listings"
          value={`${data.listings.activeOffers}`}
          testId="active-listings"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Orders by status">
          {Object.keys(data.orders.byStatus).length === 0 ? (
            <p className="text-sm text-slate-600">No orders yet.</p>
          ) : (
            <ul className="text-sm">
              {Object.entries(data.orders.byStatus).map(([s, n]) => (
                <li key={s} className="flex justify-between border-b py-1">
                  <span>{s.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="font-medium">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Returns">
          <p className="text-sm">In progress: {data.returns.requested}</p>
          <p className="text-sm">Refunded: {data.returns.completed}</p>
          <p className="mt-2 text-sm">Out-of-stock listings: {data.listings.outOfStock}</p>
        </SectionCard>
        <SectionCard title="Payouts">
          {data.payouts ? (
            <>
              <p className="text-sm">Pending: {formatPrice(data.payouts.pendingPaise)}</p>
              <p className="text-sm">Paid: {formatPrice(data.payouts.paidPaise)}</p>
            </>
          ) : (
            <p className="text-sm text-slate-600" data-testid="payouts-pending">
              Payout statements appear here once settlements start (T+7 after delivery).
            </p>
          )}
        </SectionCard>
      </div>
      <SectionCard title="Daily sales (30 days)">
        {data.daily.length === 0 ? (
          <p className="text-sm text-slate-600">
            No sales yet.{' '}
            <Link href="/listings/new" className="text-brand-dark underline">
              Add a listing
            </Link>
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.daily.map((d) => (
              <li key={d.date} className="flex items-center gap-2">
                <span className="w-24 text-slate-600">{d.date}</span>
                <span
                  className="h-3 bg-brand"
                  style={{ width: `${(d.salesPaise / maxDay) * 60}%` }}
                  aria-hidden
                />
                <span>
                  {formatPrice(d.salesPaise)} · {d.orders} orders
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
