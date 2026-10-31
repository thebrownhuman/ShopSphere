'use client';

import { RETURN_REASONS, type ReturnStatus, type SellerReturn } from '@shopsphere/types';
import { Button, formatPaise, SectionCard } from '@shopsphere/ui';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/field';
import { api, ApiCallError } from '@/lib/api';

const LABEL: Record<ReturnStatus, string> = {
  REQUESTED: 'Pickup not booked',
  PICKUP_SCHEDULED: 'Pickup scheduled',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit to you',
  RECEIVED: 'Received: QC pending',
  QC_FAILED: 'QC failed',
  REFUNDED: 'Refunded',
};
const FILTERS: (ReturnStatus | '')[] = [
  '',
  'RECEIVED',
  'PICKUP_SCHEDULED',
  'REFUNDED',
  'QC_FAILED',
];
const reasonLabel = (code: string) => RETURN_REASONS.find((r) => r.code === code)?.label ?? code;

/** Seller returns (M6.1): track reverse pickups, re-book a failed pickup, QC on receipt. */
export default function ReturnsPage() {
  const [status, setStatus] = useState<ReturnStatus | ''>('');
  const [items, setItems] = useState<SellerReturn[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: ReturnStatus | '') => {
    try {
      const page = await api<{ items: SellerReturn[] }>(
        `/seller/returns${s ? `?status=${s}` : ''}`,
      );
      setItems(page.items);
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Could not load returns');
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [load, status]);

  async function act(r: SellerReturn, path: 'pickup' | 'qc', json?: unknown) {
    setBusy(r.id);
    setError(null);
    try {
      const updated = await api<SellerReturn>(`/seller/returns/${r.id}/${path}`, {
        method: 'POST',
        json,
      });
      setItems((prev) => prev?.map((x) => (x.id === r.id ? updated : x)) ?? null);
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Returns</h1>
        <label className="text-sm">
          Status{' '}
          <select
            className="rounded border border-slate-300 px-2 py-1"
            value={status}
            onChange={(e) => setStatus(e.target.value as ReturnStatus | '')}
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f ? LABEL[f] : 'All'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      {items?.length === 0 && <p className="text-slate-600">No returns.</p>}
      {items?.map((r) => (
        <SectionCard key={r.id} title={`Order ${r.orderNumber}`}>
          <div className="grid gap-3 text-sm md:grid-cols-[1fr_260px]" data-testid="seller-return">
            <div>
              <p>
                <b data-testid="seller-return-status">{LABEL[r.status]}</b> ·{' '}
                {reasonLabel(r.reason)}
                {r.comment && <> · “{r.comment}”</>}
              </p>
              <ul className="my-1 list-disc pl-5">
                {r.items.map((i) => (
                  <li key={i.title + (i.variant ?? '')}>
                    {i.title}
                    {i.variant && ` (${i.variant})`} × {i.qty}
                  </li>
                ))}
              </ul>
              <p className="text-slate-600">
                Pickup {r.pickupDate} from {r.pickupFrom.city} {r.pickupFrom.pincode}
                {r.awb && ` · AWB ${r.awb}`} · Refund {formatPaise(r.amountPaise)} (
                {r.refundTo === 'STORE_BALANCE' ? 'store balance' : 'original method'})
              </p>
              {r.qcNote && <p className="text-slate-600">QC note: {r.qcNote}</p>}
            </div>
            <div className="space-y-2">
              {r.status === 'REQUESTED' && (
                <Button
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => void act(r, 'pickup')}
                >
                  Book pickup
                </Button>
              )}
              {r.status === 'RECEIVED' && (
                <>
                  <textarea
                    aria-label="QC note"
                    placeholder="QC note (optional)"
                    className="w-full rounded border border-slate-300 px-2 py-1"
                    rows={2}
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="buy"
                      disabled={busy === r.id}
                      data-testid="qc-pass"
                      onClick={() =>
                        void act(r, 'qc', { result: 'PASS', note: notes[r.id] || undefined })
                      }
                    >
                      QC pass &amp; refund
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy === r.id}
                      onClick={() =>
                        void act(r, 'qc', { result: 'FAIL', note: notes[r.id] || undefined })
                      }
                    >
                      QC fail
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
