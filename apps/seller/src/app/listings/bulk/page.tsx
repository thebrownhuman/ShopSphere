'use client';

import type { BulkReport, SellerCategory } from '@shopsphere/types';
import { Button, cx, SectionCard } from '@shopsphere/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, inputClass } from '@/components/field';
import { API_URL, api, ApiCallError, fileToBase64, getToken } from '@/lib/api';

/** Bulk listing (M5.3): download a category template, upload CSV/XLSX, read the row report. */
export default function BulkPage() {
  const [categories, setCategories] = useState<SellerCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [report, setReport] = useState<BulkReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SellerCategory[]>('/seller/categories').then(setCategories, () => setCategories([]));
  }, []);

  async function downloadTemplate() {
    setError(null);
    const res = await fetch(
      `${API_URL}/seller/listings/bulk/template.csv?categoryId=${categoryId}`,
      {
        headers: { Authorization: `Bearer ${getToken()}` },
      },
    );
    if (!res.ok) return setError('Could not download the template');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download =
      /filename="?([^";]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
      'template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(
        await api<BulkReport>('/seller/listings/bulk', {
          method: 'POST',
          json: { fileName: file.name, dataBase64: await fileToBase64(file), dryRun },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Bulk upload</h1>
      <SectionCard title="1. Download a template">
        <p className="mb-3 text-sm text-slate-600">
          One row per SKU. Rows with the same <code>group_id</code> become one product with
          variants. Prices are in rupees. Separate multiple bullets or image URLs with{' '}
          <code>|</code>.
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Template category"
            className={`${inputClass} max-w-md`}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Choose a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.pathLabel}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={!categoryId}
            onClick={() => void downloadTemplate()}
          >
            Download CSV template
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="2. Upload your sheet">
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="sheet" className="mb-1 block text-sm font-medium">
              CSV or XLSX file (max 1,000 rows)
            </label>
            <input
              id="sheet"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            Validate only (don&apos;t create listings)
          </label>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={!file || busy}>
            {dryRun ? 'Validate file' : 'Upload and create listings'}
          </Button>
        </form>
      </SectionCard>

      {report && (
        <SectionCard title="Validation report">
          <p className="mb-3 text-sm" data-testid="bulk-summary">
            {report.totalRows} rows · {report.validRows} valid · {report.errorRows} with errors
            {!report.dryRun &&
              ` · ${report.productsCreated} products / ${report.skusCreated} SKUs created`}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="p-2">Row</th>
                <th className="p-2">SKU</th>
                <th className="p-2">Status</th>
                <th className="p-2">Problems</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.row} className="border-t" data-testid="bulk-row">
                  <td className="p-2">{r.row || 'Header'}</td>
                  <td className="p-2">{r.skuCode ?? '—'}</td>
                  <td
                    className={cx(
                      'p-2 font-medium',
                      r.status === 'OK' ? 'text-green-700' : 'text-deal',
                    )}
                  >
                    {r.status}
                  </td>
                  <td className="p-2">
                    {r.errors.map((e) => (
                      <div key={`${e.column}${e.message}`}>
                        <code>{e.column}</code>: {e.message}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}
    </div>
  );
}
