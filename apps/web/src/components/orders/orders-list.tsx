'use client';

import { Badge, formatPaise, Skeleton } from '@shopsphere/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { ordersApi } from '@/lib/api/orders';
import type { OrdersQuery } from '@/lib/api/orders.types';
import { formatDeliveryDate } from '@/lib/delivery';
import { useRequester } from '@/lib/use-requester';
import { STATUS_LABEL } from './status';

const TABS: Array<{ value: NonNullable<OrdersQuery['status']>; label: string }> = [
  { value: 'ALL', label: 'All orders' },
  { value: 'ACTIVE', label: 'Not yet delivered' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

/** M4.28 "Your Orders": filter by year and status; filters live in the URL. */
export function OrdersList() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { request, ready, needsSignIn } = useRequester();
  const api = useMemo(() => ordersApi(request), [request]);
  const query: OrdersQuery = {
    year: Number(params.get('year')) || undefined,
    status: (params.get('status') as OrdersQuery['status']) ?? 'ALL',
  };
  const { data, isLoading, isError } = useQuery({
    queryKey: ['orders', query],
    queryFn: () => api.list(query),
    enabled: ready,
  });

  const setParam = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next}`);
  };

  if (needsSignIn) {
    return (
      <p className="rounded bg-white p-6">
        <Link href="/signin?returnTo=/orders" className="text-brand-dark underline">
          Sign in
        </Link>{' '}
        to see your orders.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Order status" className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={query.status === t.value}
              onClick={() => setParam('status', t.value === 'ALL' ? undefined : t.value)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm aria-pressed:border-brand aria-pressed:bg-blue-50 aria-pressed:font-semibold"
            >
              {t.label}
            </button>
          ))}
        </nav>
        <label className="text-sm">
          Placed in{' '}
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1"
            value={query.year ?? ''}
            onChange={(e) => setParam('year', e.target.value || undefined)}
          >
            <option value="">Any time</option>
            {data?.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isLoading || !ready ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : isError ? (
        <p role="alert" className="rounded bg-white p-6">
          Could not load your orders. Please refresh.
        </p>
      ) : !data?.orders.length ? (
        <p className="rounded bg-white p-6">No orders match these filters.</p>
      ) : (
        <ul className="space-y-3" data-testid="orders">
          {data.orders.map((o) => (
            <li key={o.id} className="rounded border border-slate-200 bg-white">
              <div className="flex flex-wrap justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
                <span>
                  Placed{' '}
                  {new Date(o.placedAt).toLocaleDateString('en-IN', {
                    dateStyle: 'medium',
                    timeZone: 'Asia/Kolkata',
                  })}
                </span>
                <span>Total {formatPaise(o.total)}</span>
                <span>Order # {o.number}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold">
                    <Badge
                      tone={
                        o.status === 'CANCELLED' || o.status === 'PAYMENT_FAILED'
                          ? 'deal'
                          : 'neutral'
                      }
                    >
                      {STATUS_LABEL[o.status]}
                    </Badge>
                    {o.deliveryDate && o.status !== 'CANCELLED' && (
                      <span className="ml-2 text-sm font-normal">
                        {o.status === 'DELIVERED' ? 'on' : 'by'}{' '}
                        {formatDeliveryDate(o.deliveryDate)}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-sm">
                    {o.items[0]?.title}
                    {o.items.length > 1 && ` and ${o.items.length - 1} more`}
                  </p>
                </div>
                <Link
                  href={`/orders/${encodeURIComponent(o.id)}`}
                  className="rounded-full border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50"
                >
                  View order details
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
