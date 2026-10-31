'use client';

import type { InventoryPage, InventoryRow, OfferPatch } from '@shopsphere/types';
import { Button, formatPrice, SectionCard } from '@shopsphere/ui';
import { useCallback, useEffect, useState } from 'react';
import { Alert, inputClass } from '@/components/field';
import { api, ApiCallError, paiseToRupees, rupeesToPaise } from '@/lib/api';

interface Draft {
  price: string;
  mrp: string;
  stock: string;
}

/** Inventory & price table with inline edit (M5.4). */
export default function InventoryTable() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (query: string, after?: string) => {
    try {
      const params = new URLSearchParams({
        limit: '50',
        ...(query ? { q: query } : {}),
        ...(after ? { cursor: after } : {}),
      });
      const page = await api<InventoryPage>(`/seller/inventory?${params}`);
      setRows((prev) => (after ? [...prev, ...page.rows] : page.rows));
      setCursor(page.nextCursor);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiCallError ? err.message : 'Could not load inventory');
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const draftOf = (r: InventoryRow): Draft =>
    drafts[r.offerId] ?? {
      price: paiseToRupees(r.price),
      mrp: paiseToRupees(r.mrp),
      stock: String(r.stock),
    };

  async function save(r: InventoryRow, extra: OfferPatch = {}) {
    const d = draftOf(r);
    const price = rupeesToPaise(d.price);
    const mrp = rupeesToPaise(d.mrp);
    if (price === null || mrp === null || !/^\d+$/.test(d.stock)) {
      setErrors({ ...errors, [r.offerId]: 'Enter valid rupee amounts and a whole stock number' });
      return;
    }
    const patch: OfferPatch = { ...extra };
    if (price !== r.price) patch.price = price;
    if (mrp !== r.mrp) patch.mrp = mrp;
    if (Number(d.stock) !== r.stock) patch.stock = Number(d.stock);
    if (Object.keys(patch).length === 0) return;
    try {
      const updated = await api<InventoryRow>(`/seller/offers/${r.offerId}`, {
        method: 'PATCH',
        json: patch,
      });
      setRows((prev) => prev.map((x) => (x.offerId === r.offerId ? updated : x)));
      setDrafts(({ [r.offerId]: _, ...rest }) => rest);
      setErrors(({ [r.offerId]: _, ...rest }) => rest);
    } catch (err) {
      setErrors({
        ...errors,
        [r.offerId]: err instanceof ApiCallError ? err.message : 'Save failed',
      });
    }
  }

  const edit = (r: InventoryRow, k: keyof Draft, v: string) =>
    setDrafts({ ...drafts, [r.offerId]: { ...draftOf(r), [k]: v } });

  return (
    <SectionCard title="Inventory & prices">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(q);
        }}
      >
        <input
          aria-label="Search by title or SKU"
          placeholder="Search by title or SKU"
          className={`${inputClass} max-w-sm`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {loadError && <Alert>{loadError}</Alert>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="p-2">Product</th>
              <th className="p-2">SKU</th>
              <th className="p-2">Price (₹)</th>
              <th className="p-2">MRP (₹)</th>
              <th className="p-2">Stock</th>
              <th className="p-2">Reserved</th>
              <th className="p-2">Status</th>
              <th className="p-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = draftOf(r);
              const dirty = !!drafts[r.offerId];
              return (
                <tr key={r.offerId} className="border-t align-top" data-testid="inventory-row">
                  <td className="p-2">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-slate-500">
                      {Object.values(r.attributes).join(' / ')}
                    </div>
                    {errors[r.offerId] && (
                      <p role="alert" className="text-xs text-deal">
                        {errors[r.offerId]}
                      </p>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs">{r.skuCode}</td>
                  <td className="p-2">
                    <input
                      aria-label={`Price for ${r.skuCode}`}
                      className={`${inputClass} w-24`}
                      value={d.price}
                      onChange={(e) => edit(r, 'price', e.target.value)}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      aria-label={`MRP for ${r.skuCode}`}
                      className={`${inputClass} w-24`}
                      value={d.mrp}
                      onChange={(e) => edit(r, 'mrp', e.target.value)}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      aria-label={`Stock for ${r.skuCode}`}
                      className={`${inputClass} w-20`}
                      value={d.stock}
                      onChange={(e) => edit(r, 'stock', e.target.value)}
                    />
                  </td>
                  <td className="p-2">{r.reserved}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() =>
                        void save(r, { status: r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })
                      }
                      title={`Currently ${r.status}; click to toggle`}
                    >
                      {r.status === 'ACTIVE' ? 'Active' : 'Paused'}
                    </button>
                  </td>
                  <td className="p-2">
                    <Button size="sm" disabled={!dirty} onClick={() => void save(r)}>
                      Save
                    </Button>
                    <div className="mt-1 text-xs text-slate-500">{formatPrice(r.price)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !loadError && (
        <p className="text-sm text-slate-600">No listings yet.</p>
      )}
      {cursor && (
        <Button variant="secondary" className="mt-3" onClick={() => void load(q, cursor)}>
          Load more
        </Button>
      )}
    </SectionCard>
  );
}
