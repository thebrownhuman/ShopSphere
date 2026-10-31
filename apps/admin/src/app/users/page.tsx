'use client';

import { STAFF_ROLES, type AdminUserRow, type Page, type StaffRole } from '@shopsphere/types';
import { SectionCard } from '@shopsphere/ui';
import { useState } from 'react';
import { Alert } from '@/components/field';
import { linkButton, SearchBar, StatusPill, Table } from '@/components/table';
import { useAdmin } from '@/lib/admin-context';
import { api } from '@/lib/api';
import { attempt, useLoad } from '@/lib/use-load';

export default function UsersPage() {
  const { can, me } = useAdmin();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, reload } = useLoad<Page<AdminUserRow>>(
    `/admin/users?q=${encodeURIComponent(query)}`,
  );
  const [msg, setMsg] = useState<string | null>(null);

  const setStatus = async (u: AdminUserRow) => {
    const status = u.status === 'active' ? 'suspended' : 'active';
    setMsg(
      await attempt(() => api(`/admin/users/${u.id}/status`, { method: 'POST', json: { status } })),
    );
    await reload();
  };

  const toggleRole = async (u: AdminUserRow, role: StaffRole) => {
    const roles = u.roles.includes(role) ? u.roles.filter((r) => r !== role) : [...u.roles, role];
    setMsg(
      await attempt(() => api(`/admin/users/${u.id}/roles`, { method: 'PUT', json: { roles } })),
    );
    await reload();
  };

  return (
    <SectionCard title="Users">
      <SearchBar
        value={q}
        onChange={setQ}
        onSubmit={() => setQuery(q)}
        placeholder="Name, email, phone or id"
      />
      {(error || msg) && <Alert>{error ?? msg}</Alert>}
      <Table
        label="Users"
        head={['Name', 'Email / phone', 'Status', 'Staff roles', '']}
        rows={(data?.items ?? []).map((u) => ({
          key: u.id,
          cells: [
            u.name ?? '—',
            <span key="c">
              {u.email ?? ''} {u.phone ?? ''}
            </span>,
            <StatusPill key="s" status={u.status} />,
            can('SUPER_ADMIN') ? (
              <div key="r" className="flex flex-wrap gap-2">
                {STAFF_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={u.roles.includes(r)}
                      disabled={u.id === me?.id && r === 'SUPER_ADMIN'}
                      onChange={() => void toggleRole(u, r)}
                    />
                    {r}
                  </label>
                ))}
              </div>
            ) : (
              u.roles.join(', ') || '—'
            ),
            u.id !== me?.id && u.status !== 'deleted' ? (
              <button
                key="a"
                type="button"
                className={linkButton}
                onClick={() => void setStatus(u)}
              >
                {u.status === 'active' ? 'Suspend' : 'Reactivate'}
              </button>
            ) : null,
          ],
        }))}
      />
      {data && <p className="mt-2 text-xs text-slate-500">{data.total} users</p>}
    </SectionCard>
  );
}
