'use client';

import {
  RETURN_REASONS,
  type RefundTarget,
  type ReturnReason,
  type ReturnStatus,
  type ReturnView,
} from '@shopsphere/types';
import { Button, formatPaise } from '@shopsphere/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { CHECKOUT_MOCK } from '@/lib/api/checkout';
import { returnsApi } from '@/lib/api/returns';
import { useRequester } from '@/lib/use-requester';
import { Modal } from '../modal';

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  REQUESTED: 'Return requested, booking pickup',
  PICKUP_SCHEDULED: 'Pickup scheduled',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'On its way to the seller',
  RECEIVED: 'Received by seller, quality check pending',
  QC_FAILED: 'Quality check failed',
  REFUNDED: 'Refunded',
};

const RETURN_ORDER_STATUSES = ['DELIVERED', 'RETURN_REQUESTED', 'PICKED_UP', 'REFUNDED'];

const day = (ymd: string) =>
  new Date(`${ymd}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });

const TARGET_LABEL: Record<RefundTarget, string> = {
  ORIGINAL: 'Original payment method (5–7 working days)',
  STORE_BALANCE: 'ShopSphere Pay balance (instant)',
};

function ReturnSummary({ r }: { r: ReturnView }) {
  return (
    <div className="text-sm" data-testid="return-summary">
      <p>
        <b data-testid="return-status">{RETURN_STATUS_LABEL[r.status]}</b>
        {r.status === 'PICKUP_SCHEDULED' && ` · pickup on ${day(r.pickupDate)}`}
      </p>
      <p className="text-slate-700">
        Refund {formatPaise(r.amountPaise)} to {TARGET_LABEL[r.refundTo]}
        {r.awb && ` · Pickup AWB ${r.awb}`}
      </p>
      {r.status === 'QC_FAILED' && (
        <p className="text-deal">
          {r.qcNote ?? 'The returned item did not pass the quality check.'}{' '}
          <Link href={`/help/contact?orderId=${r.orderId}`} className="underline">
            Contact support
          </Link>
        </p>
      )}
    </div>
  );
}

/** M6.1 return section on the order page: eligibility, the request form, and the return status. */
export function ReturnPanel({ orderId, orderStatus }: { orderId: string; orderStatus: string }) {
  const { request, ready } = useRequester();
  const api = useMemo(() => returnsApi(request), [request]);
  const qc = useQueryClient();
  const enabled = ready && !CHECKOUT_MOCK && RETURN_ORDER_STATUSES.includes(orderStatus);
  const { data: info } = useQuery({
    queryKey: ['return', orderId, orderStatus],
    queryFn: () => api.info(orderId),
    enabled,
  });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReturnReason>('DAMAGED');
  const [comment, setComment] = useState('');
  const [pickupDate, setPickupDate] = useState<string | null>(null);
  const [refundTo, setRefundTo] = useState<RefundTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled || !info) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.create(orderId, {
        reason,
        comment: comment || undefined,
        pickupDate: pickupDate ?? info.pickupDates[0]!,
        refundTo: refundTo ?? info.refundTargets[0]!,
      });
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['order', orderId] });
      await qc.invalidateQueries({ queryKey: ['return', orderId] });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not request the return.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Return" className="rounded bg-white p-4">
      <h2 className="mb-2 font-bold">Returns</h2>
      {info.current ? (
        <ReturnSummary r={info.current} />
      ) : info.eligible ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p>
            Eligible for return until{' '}
            {new Date(info.windowEndsAt!).toLocaleDateString('en-IN', {
              dateStyle: 'medium',
              timeZone: 'Asia/Kolkata',
            })}
            .{' '}
            <Link href="/help/return-policy" className="text-brand-dark underline">
              Return policy
            </Link>
          </p>
          <Button variant="secondary" onClick={() => setOpen(true)} data-testid="return-order">
            Return items
          </Button>
        </div>
      ) : (
        <p className="text-sm text-slate-700">{info.reason}</p>
      )}
      {open && (
        <Modal title="Return this order" onClose={() => setOpen(false)}>
          <label className="mb-3 block text-sm">
            Why are you returning it?
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-2"
              value={reason}
              onChange={(e) => setReason(e.target.value as ReturnReason)}
              data-testid="return-reason"
            >
              {RETURN_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-3 block text-sm">
            Comments (optional)
            <textarea
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
              rows={2}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <fieldset className="mb-3 text-sm">
            <legend className="mb-1">Pickup day</legend>
            {info.pickupDates.map((d, i) => (
              <label key={d} className="mr-4 inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="pickup"
                  checked={(pickupDate ?? info.pickupDates[0]) === d}
                  onChange={() => setPickupDate(d)}
                  data-testid={`pickup-${i}`}
                />
                {day(d)}
              </label>
            ))}
          </fieldset>
          <fieldset className="mb-4 text-sm">
            <legend className="mb-1">Refund {formatPaise(info.refundPaise)} to</legend>
            {info.refundTargets.map((t) => (
              <label key={t} className="block">
                <input
                  type="radio"
                  name="refundTo"
                  className="mr-1"
                  checked={(refundTo ?? info.refundTargets[0]) === t}
                  onChange={() => setRefundTo(t)}
                  data-testid={`refund-${t}`}
                />
                {TARGET_LABEL[t]}
              </label>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="mb-3 text-sm text-deal">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="buy" onClick={submit} disabled={busy} data-testid="confirm-return">
              {busy ? 'Requesting…' : 'Request return'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep items
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
