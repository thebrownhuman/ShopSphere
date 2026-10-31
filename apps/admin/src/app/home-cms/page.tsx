'use client';

import type {
  AdminHomeSection,
  HomeAudience,
  HomeResponse,
  HomeSectionInput,
  HomeSectionType,
} from '@shopsphere/types';
import { Button, cx, formatPrice, SectionCard } from '@shopsphere/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Field } from '@/components/field';
import { linkButton, StatusPill } from '@/components/table';
import { api } from '@/lib/api';
import { attempt, fromLocalInput, toLocalInput, useLoad } from '@/lib/use-load';

const TYPES: HomeSectionType[] = [
  'HERO_CAROUSEL',
  'DEAL_ROW',
  'PRODUCT_CAROUSEL',
  'QUAD_CARDS',
  'CATEGORY_TILES',
  'RECENTLY_VIEWED',
];

/** Starter JSON per type so editors see the expected shape. */
const TEMPLATES: Record<HomeSectionType, Record<string, unknown>> = {
  HERO_CAROUSEL: {
    banners: [
      {
        id: 'b1',
        title: 'Big Saving Days',
        subtitle: 'Up to 80% off',
        imageSeed: 'sale',
        href: '/s?discount=40',
      },
    ],
  },
  DEAL_ROW: { lightningDeals: true, limit: 12 },
  PRODUCT_CAROUSEL: { query: { q: 'phone' }, limit: 12 },
  QUAD_CARDS: { cards: [{ title: 'Top picks', source: 'categories', categorySlugs: [] }] },
  CATEGORY_TILES: { categorySlugs: [] },
  RECENTLY_VIEWED: {},
};

interface Draft {
  id: string | null;
  type: HomeSectionType;
  title: string;
  json: string;
  audience: HomeAudience;
  active: boolean;
  starts: string;
  ends: string;
}

const blank = (type: HomeSectionType = 'HERO_CAROUSEL'): Draft => ({
  id: null,
  type,
  title: '',
  json: JSON.stringify(TEMPLATES[type], null, 2),
  audience: 'ALL',
  active: true,
  starts: '',
  ends: '',
});

const scheduleLabel = (s: AdminHomeSection) =>
  !s.startsAt && !s.endsAt
    ? 'Always'
    : `${s.startsAt ? new Date(s.startsAt).toLocaleString('en-IN') : '…'} → ${
        s.endsAt ? new Date(s.endsAt).toLocaleString('en-IN') : '…'
      }`;

/** Home-page CMS (M6.7): drag to reorder, edit/schedule sections, preview at any time. */
export default function HomeCmsPage() {
  const { data, error, reload } = useLoad<AdminHomeSection[]>('/admin/home/sections');
  const [order, setOrder] = useState<AdminHomeSection[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [previewAt, setPreviewAt] = useState('');
  const [audience, setAudience] = useState<'GUEST' | 'SIGNED_IN'>('GUEST');
  const [preview, setPreview] = useState<HomeResponse | null>(null);

  useEffect(() => {
    if (data) {
      setOrder(data);
      setDirty(false);
    }
  }, [data]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    setDirty(true);
  };

  const saveOrder = async () => {
    const err = await attempt(() =>
      api('/admin/home/sections/reorder', {
        method: 'POST',
        json: { ids: order.map((s) => s.id) },
      }),
    );
    setMsg(err ? { tone: 'error', text: err } : { tone: 'ok', text: 'Order saved' });
    await reload();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    let dataSource: Record<string, unknown>;
    try {
      dataSource = JSON.parse(draft.json) as Record<string, unknown>;
    } catch {
      setMsg({ tone: 'error', text: 'Data source is not valid JSON' });
      return;
    }
    const body: HomeSectionInput = {
      type: draft.type,
      title: draft.title,
      dataSource,
      audience: draft.audience,
      active: draft.active,
      startsAt: fromLocalInput(draft.starts),
      endsAt: fromLocalInput(draft.ends),
    };
    const err = await attempt(() =>
      draft.id
        ? api(`/admin/home/sections/${draft.id}`, { method: 'PUT', json: body })
        : api('/admin/home/sections', { method: 'POST', json: body }),
    );
    setMsg(err ? { tone: 'error', text: err } : { tone: 'ok', text: 'Section saved' });
    if (!err) setDraft(null);
    await reload();
  };

  const remove = async (s: AdminHomeSection) => {
    if (!window.confirm(`Delete "${s.title}"?`)) return;
    setMsg(
      await attempt(() => api(`/admin/home/sections/${s.id}`, { method: 'DELETE' })).then((e) =>
        e ? { tone: 'error', text: e } : null,
      ),
    );
    await reload();
  };

  const loadPreview = async () => {
    const qs = new URLSearchParams({ audience });
    const at = fromLocalInput(previewAt);
    if (at) qs.set('at', at);
    const err = await attempt(async () =>
      setPreview(await api<HomeResponse>(`/admin/home/preview?${qs}`)),
    );
    if (err) setMsg({ tone: 'error', text: err });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-4">
        <SectionCard
          title="Home page sections"
          action={
            <div className="flex gap-2">
              {dirty && <Button onClick={() => void saveOrder()}>Save order</Button>}
              <Button variant="secondary" onClick={() => setDraft(blank())}>
                Add section
              </Button>
            </div>
          }
        >
          {(error || msg) && (
            <div className="mb-3">
              <Alert tone={msg?.tone ?? 'error'}>{error ?? msg?.text}</Alert>
            </div>
          )}
          <p className="mb-2 text-xs text-slate-500">
            Drag rows (or use ↑ ↓) to reorder, then save.
          </p>
          <ol aria-label="Sections in display order" className="space-y-2">
            {order.map((s, i) => (
              <li
                key={s.id}
                draggable
                onDragStart={() => setDragging(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging !== null) move(dragging, i);
                  setDragging(null);
                }}
                className={cx(
                  'flex cursor-move items-center gap-3 rounded border bg-white p-3',
                  dragging === i && 'opacity-50',
                )}
              >
                <span aria-hidden className="text-slate-400">
                  ⋮⋮
                </span>
                <div className="flex-1">
                  <p className="font-medium">{s.title}</p>
                  <p className="text-xs text-slate-500">
                    {s.type} · {s.audience} · {scheduleLabel(s)}
                  </p>
                </div>
                <StatusPill status={s.active ? 'ACTIVE' : 'HIDDEN'} />
                <button
                  type="button"
                  aria-label={`Move ${s.title} up`}
                  className={linkButton}
                  onClick={() => move(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${s.title} down`}
                  className={linkButton}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={linkButton}
                  onClick={() =>
                    setDraft({
                      id: s.id,
                      type: s.type,
                      title: s.title,
                      json: JSON.stringify(s.dataSource, null, 2),
                      audience: s.audience,
                      active: s.active,
                      starts: toLocalInput(s.startsAt),
                      ends: toLocalInput(s.endsAt),
                    })
                  }
                >
                  Edit
                </button>
                <button type="button" className={linkButton} onClick={() => void remove(s)}>
                  Delete
                </button>
              </li>
            ))}
          </ol>
        </SectionCard>

        {draft && (
          <SectionCard title={draft.id ? 'Edit section' : 'New section'}>
            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Type
                <select
                  className="mt-1 block h-10 w-full rounded border px-2"
                  value={draft.type}
                  onChange={(e) => {
                    const type = e.target.value as HomeSectionType;
                    setDraft({
                      ...draft,
                      type,
                      json: draft.id ? draft.json : JSON.stringify(TEMPLATES[type], null, 2),
                    });
                  }}
                >
                  {TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <Field
                label="Title"
                required
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <label className="text-sm font-medium text-slate-700">
                Audience
                <select
                  className="mt-1 block h-10 w-full rounded border px-2"
                  value={draft.audience}
                  onChange={(e) => setDraft({ ...draft, audience: e.target.value as HomeAudience })}
                >
                  <option value="ALL">Everyone</option>
                  <option value="GUEST">Guests</option>
                  <option value="SIGNED_IN">Signed-in shoppers</option>
                </select>
              </label>
              <label className="flex items-center gap-2 self-end text-sm">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                />
                Visible
              </label>
              <Field
                label="Show from (optional)"
                type="datetime-local"
                value={draft.starts}
                onChange={(e) => setDraft({ ...draft, starts: e.target.value })}
              />
              <Field
                label="Show until (optional)"
                type="datetime-local"
                value={draft.ends}
                onChange={(e) => setDraft({ ...draft, ends: e.target.value })}
              />
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                Data source (JSON)
                <textarea
                  className="mt-1 block h-48 w-full rounded border p-2 font-mono text-xs"
                  value={draft.json}
                  onChange={(e) => setDraft({ ...draft, json: e.target.value })}
                />
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit">Save section</Button>
                <Button variant="secondary" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </SectionCard>
        )}
      </div>

      <SectionCard title="Preview">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field
            label="As of (blank = now)"
            type="datetime-local"
            value={previewAt}
            onChange={(e) => setPreviewAt(e.target.value)}
          />
          <label className="text-sm font-medium text-slate-700">
            Viewer
            <select
              className="mt-1 block h-10 rounded border px-2"
              value={audience}
              onChange={(e) => setAudience(e.target.value as 'GUEST' | 'SIGNED_IN')}
            >
              <option value="GUEST">Guest</option>
              <option value="SIGNED_IN">Signed in</option>
            </select>
          </label>
          <Button onClick={() => void loadPreview()}>Preview</Button>
        </div>
        {preview && (
          <ol aria-label="Preview" className="space-y-3">
            {preview.sections.map((s) => (
              <li key={s.id} className="rounded border p-3">
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="text-xs text-slate-500">{s.type}</p>
                {s.type === 'HERO_CAROUSEL' && (
                  <ul className="mt-1 text-xs">
                    {s.banners.map((b) => (
                      <li key={b.id}>🖼 {b.title}</li>
                    ))}
                  </ul>
                )}
                {s.type === 'DEAL_ROW' && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {s.deals.slice(0, 6).map((d) => (
                      <li key={d.product.productId}>
                        {d.product.title} —{' '}
                        {d.product.pricing ? formatPrice(d.product.pricing.price) : '—'} ·{' '}
                        {d.claimedPercent}% claimed
                      </li>
                    ))}
                  </ul>
                )}
                {(s.type === 'PRODUCT_CAROUSEL' || s.type === 'RECENTLY_VIEWED') && (
                  <p className="mt-1 text-xs">{s.products.length} products</p>
                )}
              </li>
            ))}
            {preview.sections.length === 0 && (
              <p className="text-sm text-slate-600">No sections would show.</p>
            )}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}
