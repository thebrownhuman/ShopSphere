'use client';

import type { AdminSellerRow, Page, SellerAccountView } from '@shopsphere/types';
import { SectionCard } from '@shopsphere/ui';
import { useState } from 'react';
import { Alert } from '@/components/field';
import { linkButton, SearchBar, StatusPill, Table } from '@/components/table';
import { useAdmin } from '@/lib/admin-context';
import { api } from '@/lib/api';
import { attempt, useLoad } from '@/lib/use-load';

/** KYC approval queue (seller module) + seller directory with suspension. */
export default function SellersPage() {
  const { can } = useAdmin();
  const catalog = can('CATALOG');
  const [msg, setMsg] = useState<string | null>(null);
  const queue = useLoad<SellerAccountView[]>(catalog ? '/admin/sellers/applications' : null);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const sellers = useLoad<Page<AdminSellerRow>>(`/admin/sellers?q=${encodeURIComponent(query)}`);

  const decide = async (id: string, approve: boolean) => {
    const reason = approve ? null : window.prompt('Reason for rejection');
    if (!approve && !reason) return;
    setMsg(
      await attempt(() =>
        api(`/admin/sellers/applications/${id}/${approve ? 'approve' : 'reject'}`, {
          method: 'POST',
          json: approve ? {} : { reason },
        }),
      ),
    );
    await Promise.all([queue.reload(), sellers.reload()]);
  };

  const setStatus = async (s: AdminSellerRow) => {
    const status = s.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setMsg(
      await attempt(() =>
        api(`/admin/sellers/${s.id}/status`, { method: 'POST', json: { status } }),
      ),
    );
    await sellers.reload();
  };

  return (
    <div className="space-y-4">
      {msg && <Alert>{msg}</Alert>}
      {catalog && (
        <SectionCard title="KYC approval queue">
          {queue.error && <Alert>{queue.error}</Alert>}
          <Table
            label="Seller applications"
            empty="No applications waiting."
            head={['Display name', 'Legal name', 'PAN / GSTIN', 'Bank', 'Submitted', '']}
            rows={(queue.data ?? []).map((a) => ({
              key: a.id,
              cells: [
                a.displayName,
                a.legalName ?? '—',
                `${a.pan ?? '—'} / ${a.gstin ?? '—'}`,
                a.bank ? `${a.bank.holderName} ••${a.bank.accountLast4}` : '—',
                a.submittedAt ? new Date(a.submittedAt).toLocaleString('en-IN') : '—',
                <span key="a" className="flex gap-3">
                  <button
                    type="button"
                    className={linkButton}
                    onClick={() => void decide(a.id, true)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className={linkButton}
                    onClick={() => void decide(a.id, false)}
                  >
                    Reject
                  </button>
                </span>,
              ],
            }))}
          />
        </SectionCard>
      )}
      <SectionCard title="Sellers">
        <SearchBar
          value={q}
          onChange={setQ}
          onSubmit={() => setQuery(q)}
          placeholder="Seller name"
        />
        <Table
          label="Sellers"
          head={['Name', 'Location', 'Type', 'Status', '']}
          rows={(sellers.data?.items ?? []).map((s) => ({
            key: s.id,
            cells: [
              s.name,
              `${s.city}, ${s.state}`,
              s.isFirstParty ? 'ShopSphere warehouse' : 'Marketplace',
              <StatusPill key="s" status={s.status} />,
              catalog ? (
                <button
                  key="b"
                  type="button"
                  className={linkButton}
                  onClick={() => void setStatus(s)}
                >
                  {s.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                </button>
              ) : null,
            ],
          }))}
        />
      </SectionCard>
    </div>
  );
}
