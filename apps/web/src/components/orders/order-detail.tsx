'use client';

import { Button, formatPaise, Skeleton, Timeline } from '@shopsphere/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { ordersApi } from '@/lib/api/orders';
import type { OrderDetail } from '@/lib/api/orders.types';
import { formatDeliveryDate } from '@/lib/delivery';
import { useRequester } from '@/lib/use-requester';
import { addressLine } from '../checkout/steps';
import { PriceBreakdown } from '../checkout/price-breakdown';
import { Modal } from '../modal';
import { ReturnPanel } from './return-panel';
import { STATUS_LABEL, timelineSteps } from './status';

const REASONS = [
  'Ordered by mistake',
  'Found a better price',
  'Delivery is too slow',
  'Want to change address or payment',
  'Other',
];

function CancelOrder({ order, onDone }: { order: OrderDetail; onDone: (o: OrderDetail) => void }) {
  const { request } = useRequester();
  const api = useMemo(() => ordersApi(request), [request]);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.cancel(order.id, reason));
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not cancel. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="cancel-order">
        Cancel order
      </Button>
      {open && (
        <Modal title="Cancel this order?" onClose={() => setOpen(false)}>
          <label className="mb-3 block text-sm">
            Reason
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <p className="mb-4 text-sm text-slate-700">
            {order.paymentMethod === 'COD'
              ? 'Nothing was charged for this order.'
              : 'Your refund goes back to the original payment method in 5–7 working days.'}
          </p>
          {error && (
            <p role="alert" className="mb-3 text-sm text-deal">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="buy" onClick={confirm} disabled={busy}>
              {busy ? 'Cancelling…' : 'Yes, cancel order'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep order
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * M4.28 order detail: shipments with tracking timeline, invoice download, cancel (before SHIPPED),
 * and returns (M6.1).
 */
export function OrderDetailView({ id }: { id: string }) {
  const { request, ready, needsSignIn } = useRequester();
  const api = useMemo(() => ordersApi(request), [request]);
  const qc = useQueryClient();
  const key = ['order', id];
  const {
    data: order,
    isLoading,
    isError,
  } = useQuery({
    queryKey: key,
    queryFn: () => api.get(id),
    enabled: ready,
  });

  if (needsSignIn) {
    return (
      <p className="rounded bg-white p-6">
        <Link
          href={`/signin?returnTo=${encodeURIComponent(`/orders/${id}`)}`}
          className="text-brand-dark underline"
        >
          Sign in
        </Link>{' '}
        to see this order.
      </p>
    );
  }
  if (isLoading || !ready) return <Skeleton className="h-64 w-full" />;
  if (isError || !order) {
    return (
      <p role="alert" className="rounded bg-white p-6">
        {isError ? 'Could not load this order.' : 'Order not found.'}{' '}
        <Link href="/orders" className="text-brand-dark underline">
          Your orders
        </Link>
      </p>
    );
  }

  const itemCount = order.shipments.flatMap((s) => s.items).reduce((t, i) => t + i.qty, 0);
  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/orders" className="text-brand-dark hover:underline">
          Your Orders
        </Link>{' '}
        › Order # {order.number}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Order details</h1>
          <p className="text-sm text-slate-700">
            Ordered on{' '}
            {new Date(order.placedAt).toLocaleDateString('en-IN', {
              dateStyle: 'long',
              timeZone: 'Asia/Kolkata',
            })}{' '}
            · Order # {order.number} ·{' '}
            <b data-testid="order-status">{STATUS_LABEL[order.status]}</b>
          </p>
        </div>
        {order.cancellable && (
          <CancelOrder
            order={order}
            onDone={(o) => {
              qc.setQueryData(key, o);
              void qc.invalidateQueries({ queryKey: ['orders'] });
            }}
          />
        )}
      </div>
      <div className="grid gap-4 rounded bg-white p-4 md:grid-cols-3">
        <div className="text-sm">
          <h2 className="mb-1 font-bold">Shipping address</h2>
          <p>{order.address.name}</p>
          <p>{addressLine(order.address)}</p>
          <p>{order.address.phone}</p>
        </div>
        <div className="text-sm">
          <h2 className="mb-1 font-bold">Payment method</h2>
          <p>
            {
              {
                BANK: 'ShopSphere Bank',
                RAZORPAY: 'Razorpay',
                COD: 'Cash on Delivery',
                GIFT_CARD: 'Gift card',
              }[order.paymentMethod]
            }
          </p>
        </div>
        <PriceBreakdown price={order.price} itemCount={itemCount} />
      </div>
      <ReturnPanel orderId={order.id} orderStatus={order.status} />
      {order.shipments.map((sh, i) => (
        <section
          key={sh.id}
          className="grid gap-4 rounded bg-white p-4 md:grid-cols-[1fr_280px]"
          aria-label={`Shipment ${i + 1}`}
        >
          <div>
            <h2 className="font-bold">
              {STATUS_LABEL[sh.status]}
              {sh.deliveryDate && sh.status !== 'CANCELLED' && (
                <span className="font-normal">
                  {' '}
                  · {sh.status === 'DELIVERED' ? 'Delivered' : 'Arriving'}{' '}
                  {formatDeliveryDate(sh.deliveryDate)}
                </span>
              )}
            </h2>
            <p className="mb-2 text-xs text-slate-600">
              Sold by {sh.sellerName}
              {sh.trackingId && ` · Tracking ID ${sh.trackingId}`}
            </p>
            <ul className="divide-y divide-slate-100">
              {sh.items.map((it) => (
                <li key={it.skuId} className="flex justify-between gap-3 py-2 text-sm">
                  <Link href={`/p/${it.slug}`} className="text-brand-dark hover:underline">
                    {it.title}
                    {it.qty > 1 && ` × ${it.qty}`}
                  </Link>
                  <b>{formatPaise(it.lineTotal)}</b>
                </li>
              ))}
            </ul>
            {sh.invoiceUrl && (
              <a
                href={sh.invoiceUrl}
                className="mt-2 inline-block text-sm text-brand-dark underline"
                download
              >
                Download invoice (PDF)
              </a>
            )}
          </div>
          <Timeline
            label={`Tracking for shipment ${i + 1}`}
            steps={timelineSteps(sh.status, sh.tracking)}
          />
        </section>
      ))}
    </div>
  );
}
