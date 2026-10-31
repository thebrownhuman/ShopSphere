'use client';

import type {
  SellerOrdersPage,
  SellerShipment,
  SellerShipmentDetail,
  ShipmentStatus,
} from '@shopsphere/types';
import { Badge, Button, formatPrice, SectionCard } from '@shopsphere/ui';
import { useCallback, useEffect, useState } from 'react';
import { Alert, inputClass } from '@/components/field';
import { API_URL, api, ApiCallError, getToken } from '@/lib/api';

const FILTERS: { label: string; value: string }[] = [
  { label: 'To accept', value: 'CONFIRMED' },
  { label: 'To pack', value: 'ACCEPTED' },
  { label: 'Ready for label', value: 'PACKED' },
  { label: 'Awaiting pickup', value: 'LABEL_CREATED' },
  { label: 'In transit', value: 'SHIPPED,OUT_FOR_DELIVERY' },
  { label: 'Delivered', value: 'DELIVERED' },
  { label: 'All', value: '' },
];

const STATUS_LABEL: Partial<Record<ShipmentStatus, string>> = {
  CONFIRMED: 'New',
  ACCEPTED: 'Accepted',
  PACKED: 'Packed',
  LABEL_CREATED: 'Label ready',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

/** Seller order queue (M5.5): accept → pack → generate label, with tracking. */
export default function OrdersPage() {
  const [filter, setFilter] = useState('CONFIRMED');
  const [items, setItems] = useState<SellerShipment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<SellerShipmentDetail | null>(null);
  const [weights, setWeights] = useState<Record<string, string>>({});

  const load = useCallback(async (status: string, after?: string) => {
    try {
      const params = new URLSearchParams({
        limit: '25',
        ...(status ? { status } : {}),
        ...(after ? { cursor: after } : {}),
      });
      const page = await api<SellerOrdersPage>(`/seller/orders?${params}`);
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Could not load orders');
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function act(s: SellerShipment, action: 'accept' | 'pack' | 'label') {
    setBusy(s.id);
    setRowError(({ [s.id]: _, ...rest }) => rest);
    try {
      const w = Number(weights[s.id]);
      const updated = await api<SellerShipment>(`/seller/orders/${s.id}/${action}`, {
        method: 'POST',
        json: action === 'pack' && w > 0 ? { weightGrams: w } : {},
      });
      setItems((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
    } catch (err) {
      setRowError((r) => ({
        ...r,
        [s.id]: err instanceof ApiCallError ? err.message : 'Action failed',
      }));
    } finally {
      setBusy(null);
    }
  }

  async function downloadLabel(s: SellerShipment) {
    const res = await fetch(`${API_URL}/seller/shipments/${s.id}/label.pdf`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      setRowError((r) => ({ ...r, [s.id]: 'Label not available yet' }));
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function openDetail(s: SellerShipment) {
    try {
      setDetail(await api<SellerShipmentDetail>(`/seller/shipments/${s.id}`));
    } catch (err) {
      setRowError((r) => ({
        ...r,
        [s.id]: err instanceof ApiCallError ? err.message : 'Could not load tracking',
      }));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Orders</h1>
      <div role="tablist" aria-label="Order status" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f.value ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {items.length === 0 && !error && (
        <p className="text-sm text-slate-600">No orders in this view.</p>
      )}
      {items.map((s) => (
        <SectionCard key={s.id} className="rounded">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-semibold">
                Order {s.orderNumber}{' '}
                <Badge tone={s.status === 'CANCELLED' ? 'deal' : 'neutral'}>
                  {STATUS_LABEL[s.status] ?? s.status}
                </Badge>
              </div>
              <div className="text-xs text-slate-600">
                {s.shipTo.name}, {s.shipTo.city}, {s.shipTo.state} {s.shipTo.pincode} ·{' '}
                {s.paymentMethod} · ship by {s.promisedDate.slice(0, 10)}
              </div>
              <ul className="mt-2 text-sm">
                {s.items.map((i) => (
                  <li key={i.id}>
                    {i.qty} × {i.title}
                    {i.variant ? ` (${i.variant})` : ''} — {formatPrice(i.lineTotalPaise)}
                  </li>
                ))}
              </ul>
              {s.awb && (
                <div className="mt-1 text-xs">
                  {s.courier} · AWB <code>{s.awb}</code>
                </div>
              )}
              {rowError[s.id] && (
                <p role="alert" className="mt-1 text-xs text-deal">
                  {rowError[s.id]}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="font-semibold">{formatPrice(s.itemsPaise)}</div>
              {s.status === 'CONFIRMED' && (
                <Button size="sm" disabled={busy === s.id} onClick={() => void act(s, 'accept')}>
                  Accept
                </Button>
              )}
              {s.status === 'ACCEPTED' && (
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Packed weight in grams for ${s.orderNumber}`}
                    placeholder="Weight (g)"
                    inputMode="numeric"
                    className={`${inputClass} h-8 w-28`}
                    value={weights[s.id] ?? ''}
                    onChange={(e) => setWeights({ ...weights, [s.id]: e.target.value })}
                  />
                  <Button size="sm" disabled={busy === s.id} onClick={() => void act(s, 'pack')}>
                    Mark packed
                  </Button>
                </div>
              )}
              {s.status === 'PACKED' && (
                <Button size="sm" disabled={busy === s.id} onClick={() => void act(s, 'label')}>
                  Generate label
                </Button>
              )}
              {s.labelUrl && (
                <Button size="sm" variant="secondary" onClick={() => void downloadLabel(s)}>
                  Print label
                </Button>
              )}
              {s.awb && (
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => void openDetail(s)}
                >
                  Tracking
                </button>
              )}
            </div>
          </div>
          {detail?.id === s.id && (
            <ol className="mt-3 border-t pt-2 text-xs" aria-label="Tracking timeline">
              {detail.tracking.length === 0 && <li>No courier scans yet.</li>}
              {detail.tracking.map((t) => (
                <li
                  key={`${t.status}${t.occurredAt}`}
                  className={t.applied ? '' : 'text-slate-400'}
                >
                  {new Date(t.occurredAt).toLocaleString('en-IN')} — {t.status.replace(/_/g, ' ')}
                  {t.location ? `, ${t.location}` : ''}
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      ))}
      {cursor && (
        <Button variant="secondary" onClick={() => void load(filter, cursor)}>
          Load more
        </Button>
      )}
    </div>
  );
}
