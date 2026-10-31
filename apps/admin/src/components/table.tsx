import { cx } from '@shopsphere/ui';
import type { ReactNode } from 'react';

/** Plain data table: `head` labels, `rows` of cells. */
export function Table({
  head,
  rows,
  empty = 'Nothing here yet.',
  label,
}: {
  head: ReactNode[];
  rows: { key: string; cells: ReactNode[] }[];
  empty?: string;
  label: string;
}) {
  if (!rows.length) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="border-b bg-slate-50 text-xs uppercase text-slate-600">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0">
              {r.cells.map((c, i) => (
                <td key={i} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  return (
    <form
      role="search"
      className="mb-4 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        aria-label={placeholder}
        className="h-10 flex-1 rounded border border-slate-300 bg-white px-3 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="submit" className="rounded bg-brand px-4 text-sm font-medium text-white">
        Search
      </button>
    </form>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone = /active|approved|processed|confirmed|delivered/i.test(status)
    ? 'bg-green-100 text-green-800'
    : /blocked|suspended|rejected|failed|cancel/i.test(status)
      ? 'bg-red-100 text-red-800'
      : 'bg-slate-200 text-slate-700';
  return <span className={cx('rounded px-2 py-0.5 text-xs font-medium', tone)}>{status}</span>;
}

export const linkButton = 'text-sm font-medium text-brand hover:underline disabled:opacity-50';
