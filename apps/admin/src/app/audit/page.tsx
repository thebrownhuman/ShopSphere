'use client';

import type { AuditRow, Page } from '@shopsphere/types';
import { SectionCard } from '@shopsphere/ui';
import { useState } from 'react';
import { Alert } from '@/components/field';
import { Table } from '@/components/table';
import { useLoad } from '@/lib/use-load';

export default function AuditPage() {
  const [filters, setFilters] = useState({ action: '', entityType: '', entityId: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '50' });
  for (const [k, v] of Object.entries(applied)) if (v) qs.set(k, v);
  const { data, error } = useLoad<Page<AuditRow>>(`/admin/audit?${qs}`);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <SectionCard title="Audit log">
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied(filters);
        }}
      >
        {(['action', 'entityType', 'entityId'] as const).map((k) => (
          <input
            key={k}
            aria-label={k}
            placeholder={k}
            className="h-9 rounded border px-2 text-sm"
            value={filters[k]}
            onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
          />
        ))}
        <button type="submit" className="rounded bg-brand px-3 text-sm text-white">
          Filter
        </button>
      </form>
      {error && <Alert>{error}</Alert>}
      <Table
        label="Audit entries"
        head={['When', 'Actor', 'Action', 'Entity', '']}
        rows={(data?.items ?? []).map((r) => ({
          key: r.id,
          cells: [
            new Date(r.createdAt).toLocaleString('en-IN'),
            `${r.actorType}${r.actorId ? ` ${r.actorId.slice(0, 8)}` : ''}`,
            <code key="a">{r.action}</code>,
            `${r.entityType} ${r.entityId}`,
            <div key="d">
              <button
                type="button"
                className="text-xs text-brand underline"
                onClick={() => setOpen(open === r.id ? null : r.id)}
              >
                {open === r.id ? 'Hide' : 'Details'}
              </button>
              {open === r.id && (
                <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">
                  {JSON.stringify(
                    { before: r.before, after: r.after, requestId: r.requestId },
                    null,
                    2,
                  )}
                </pre>
              )}
            </div>,
          ],
        }))}
      />
      {data && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="underline disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}
          </span>
          <button
            type="button"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage(page + 1)}
            className="underline disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </SectionCard>
  );
}
