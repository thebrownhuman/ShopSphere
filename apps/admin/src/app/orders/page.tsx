'use client';

import type { AdminOrderRow, Page } from '@shopsphere/types';
import { formatPaise, SectionCard } from '@shopsphere/ui';
import Link from 'next/link';
import { useState } from 'react';
import { Alert } from '@/components/field';
import { SearchBar, StatusPill, Table } from '@/components/table';
import { useLoad } from '@/lib/use-load';

export default function OrdersPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error } = useLoad<Page<AdminOrderRow>>(
    `/admin/orders?q=${encodeURIComponent(query)}`,
  );
  return (
    <SectionCard title="Orders">
      <SearchBar
        value={q}
        onChange={setQ}
        onSubmit={() => setQuery(q)}
        placeholder="Order number, order id or customer id"
      />
      {error && <Alert>{error}</Alert>}
      <Table
        label="Orders"
        head={['Order', 'Placed', 'Payment', 'Total', 'Status']}
        rows={(data?.items ?? []).map((o) => ({
          key: o.id,
          cells: [
            <Link
              key="l"
              href={`/orders/${o.id}`}
              className="font-medium text-brand hover:underline"
            >
              {o.number}
            </Link>,
            new Date(o.placedAt).toLocaleString('en-IN'),
            o.paymentMethod,
            formatPaise(o.totalPaise),
            <StatusPill key="s" status={o.status} />,
          ],
        }))}
      />
    </SectionCard>
  );
}
