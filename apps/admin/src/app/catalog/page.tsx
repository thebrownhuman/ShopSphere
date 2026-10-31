'use client';

import type { AdminProductRow, Page } from '@shopsphere/types';
import { SectionCard } from '@shopsphere/ui';
import { useState } from 'react';
import { Alert } from '@/components/field';
import { linkButton, SearchBar, StatusPill, Table } from '@/components/table';
import { api } from '@/lib/api';
import { attempt, useLoad } from '@/lib/use-load';

/** Catalog moderation: block a listing (drops out of search + checkout) or restore it. */
export default function CatalogPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, reload } = useLoad<Page<AdminProductRow>>(
    `/admin/products?q=${encodeURIComponent(query)}${status ? `&status=${status}` : ''}`,
  );
  const [msg, setMsg] = useState<string | null>(null);

  const moderate = async (p: AdminProductRow) => {
    const next = p.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
    const reason = window.prompt(
      next === 'BLOCKED' ? 'Why block this listing?' : 'Note for restoring',
    );
    if (!reason) return;
    setMsg(
      await attempt(() =>
        api(`/admin/products/${p.id}/status`, { method: 'POST', json: { status: next, reason } }),
      ),
    );
    await reload();
  };

  return (
    <SectionCard title="Catalog moderation">
      <SearchBar
        value={q}
        onChange={setQ}
        onSubmit={() => setQuery(q)}
        placeholder="Title, slug or id"
      />
      <label className="mb-3 flex items-center gap-2 text-sm">
        Status
        <select
          className="rounded border px-2 py-1"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Any</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          <option value="BLOCKED">Blocked</option>
        </select>
      </label>
      {(error || msg) && <Alert>{error ?? msg}</Alert>}
      <Table
        label="Products"
        head={['Title', 'Brand', 'Category', 'Status', '']}
        rows={(data?.items ?? []).map((p) => ({
          key: p.id,
          cells: [
            p.title,
            p.brand,
            p.category,
            <StatusPill key="s" status={p.status} />,
            <button key="b" type="button" className={linkButton} onClick={() => void moderate(p)}>
              {p.status === 'BLOCKED' ? 'Restore' : 'Block'}
            </button>,
          ],
        }))}
      />
      {data && <p className="mt-2 text-xs text-slate-500">{data.total} products</p>}
    </SectionCard>
  );
}
