'use client';

import type {
  FraudAssessmentView,
  FraudReviewStatus,
  FraudThresholdsView,
  Page,
} from '@shopsphere/types';
import { SectionCard } from '@shopsphere/ui';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/field';
import { linkButton, StatusPill, Table } from '@/components/table';
import { api, paiseToRupees } from '@/lib/api';
import { attempt, useLoad } from '@/lib/use-load';

const FILTERS: { value: FraudReviewStatus | ''; label: string }[] = [
  { value: 'PENDING_REVIEW', label: 'Waiting for review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: '', label: 'All flagged' },
];

/** Fraud review queue (M7.2): orders held by the risk score; approve releases, reject cancels. */
export default function FraudPage() {
  const [status, setStatus] = useState<FraudReviewStatus | ''>('PENDING_REVIEW');
  const [msg, setMsg] = useState<string | null>(null);
  const list = useLoad<Page<FraudAssessmentView>>(
    `/admin/fraud/assessments?pageSize=50${status ? `&status=${status}` : ''}`,
  );
  const thresholds = useLoad<FraudThresholdsView>('/admin/fraud/thresholds');

  const decide = async (a: FraudAssessmentView, approve: boolean) => {
    const note = window.prompt(
      approve
        ? 'Note (optional): why is this order genuine?'
        : 'Reason for rejecting (cancels the order)',
    );
    if (note === null || (!approve && !note.trim())) return;
    setMsg(
      await attempt(() =>
        api(`/admin/fraud/assessments/${a.id}/${approve ? 'approve' : 'reject'}`, {
          method: 'POST',
          json: note.trim() ? { note: note.trim() } : {},
        }),
      ),
    );
    await list.reload();
  };

  const t = thresholds.data;
  return (
    <div className="space-y-4">
      {msg && <Alert>{msg}</Alert>}
      <SectionCard title="Fraud review queue">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="fraud-filter" className="text-sm text-slate-600">
            Show
          </label>
          <select
            id="fraud-filter"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as FraudReviewStatus | '')}
          >
            {FILTERS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {list.data && <span className="text-sm text-slate-600">{list.data.total} total</span>}
        </div>
        {list.error && <Alert>{list.error}</Alert>}
        <Table
          label="Fraud assessments"
          empty="Nothing to review."
          head={['Order', 'Score', 'Signals', 'Amount', 'Payment', 'Placed', 'Review', '']}
          rows={(list.data?.items ?? []).map((a) => ({
            key: a.id,
            cells: [
              a.orderId ? (
                <Link key="o" href={`/orders/${a.orderId}`} className={linkButton}>
                  {a.orderNumber ?? a.orderId.slice(0, 8)}
                </Link>
              ) : (
                <span key="o" className="text-slate-500">
                  Blocked attempt
                </span>
              ),
              <span key="s" className="font-semibold tabular-nums">
                {a.score} <span className="font-normal text-slate-500">· {a.decision}</span>
              </span>,
              <ul key="g" className="space-y-0.5 text-xs">
                {a.signals.map((s) => (
                  <li key={s.code}>
                    <span className="font-medium">+{s.points}</span> {s.detail}
                  </li>
                ))}
              </ul>,
              `₹${paiseToRupees(a.totalPaise)}`,
              a.paymentMethod,
              new Date(a.createdAt).toLocaleString('en-IN'),
              <span key="r" className="space-y-1">
                <StatusPill status={a.reviewStatus} />
                {a.reviewNote && (
                  <span className="block text-xs text-slate-600">{a.reviewNote}</span>
                )}
              </span>,
              a.reviewStatus === 'PENDING_REVIEW' ? (
                <span key="a" className="flex gap-3">
                  <button type="button" className={linkButton} onClick={() => void decide(a, true)}>
                    Approve
                  </button>
                  <button
                    type="button"
                    className={linkButton}
                    onClick={() => void decide(a, false)}
                  >
                    Reject
                  </button>
                </span>
              ) : null,
            ],
          }))}
        />
      </SectionCard>
      {t && (
        <SectionCard title="Thresholds">
          <p className="mb-2 text-sm text-slate-600">
            Set by the API environment (FRAUD_* variables). Scores run 0–100.
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <dt className="text-slate-600">COD refused at</dt>
            <dd>{t.forcePrepaidScore}</dd>
            <dt className="text-slate-600">Manual review at</dt>
            <dd>{t.reviewScore}</dd>
            <dt className="text-slate-600">Captcha step-up at</dt>
            <dd>{t.captchaScore}</dd>
            <dt className="text-slate-600">High-value first order</dt>
            <dd>₹{paiseToRupees(t.highValuePaise)}</dd>
            <dt className="text-slate-600">New account (COD)</dt>
            <dd>&lt; {t.newAccountDays} days</dd>
            <dt className="text-slate-600">Orders / account / hour</dt>
            <dd>{t.userOrdersPerHour}</dd>
            <dt className="text-slate-600">Orders / device / hour</dt>
            <dd>{t.deviceOrdersPerHour}</dd>
            <dt className="text-slate-600">Accounts / device / day</dt>
            <dd>{t.deviceUsersPerDay}</dd>
            <dt className="text-slate-600">Orders / IP / hour</dt>
            <dd>{t.ipOrdersPerHour}</dd>
          </dl>
        </SectionCard>
      )}
    </div>
  );
}
