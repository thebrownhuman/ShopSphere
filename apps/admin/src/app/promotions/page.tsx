'use client';

import type {
  AdminCoupon,
  BankOfferView,
  DealOfferOption,
  LightningDealView,
} from '@shopsphere/types';
import { Button, cx, formatPaise, ProgressBar, SectionCard } from '@shopsphere/ui';
import { useState, type FormEvent } from 'react';
import { Alert, Field } from '@/components/field';
import { linkButton, StatusPill, Table } from '@/components/table';
import { useAdmin } from '@/lib/admin-context';
import { api, rupeesToPaise } from '@/lib/api';
import { attempt, fromLocalInput, toLocalInput, useLoad } from '@/lib/use-load';

type Tab = 'deals' | 'coupons' | 'bank';

const hourFromNow = (h: number) => toLocalInput(new Date(Date.now() + h * 3_600_000).toISOString());
const when = (iso: string) => new Date(iso).toLocaleString('en-IN');

export default function PromotionsPage() {
  const { can } = useAdmin();
  const catalog = can('CATALOG');
  const [tab, setTab] = useState<Tab>(catalog ? 'deals' : 'bank');
  const tabs: [Tab, string][] = [
    ...(catalog
      ? ([
          ['deals', 'Lightning deals'],
          ['coupons', 'Coupons'],
        ] as [Tab, string][])
      : []),
    ['bank', 'Bank offers'],
  ];
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Promotion type" className="flex gap-2">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx(
              'rounded px-4 py-2 text-sm font-medium',
              tab === k ? 'bg-brand text-white' : 'bg-white text-slate-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'deals' && <Deals />}
      {tab === 'coupons' && <Coupons />}
      {tab === 'bank' && <BankOffers />}
    </div>
  );
}

function Deals() {
  const deals = useLoad<LightningDealView[]>('/admin/promotions/deals');
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<DealOfferOption[]>([]);
  const [offer, setOffer] = useState<DealOfferOption | null>(null);
  const [form, setForm] = useState({
    title: '',
    price: '',
    cap: '50',
    starts: hourFromNow(0),
    ends: hourFromNow(6),
  });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const find = async () => {
    const err = await attempt(async () =>
      setOptions(
        await api<DealOfferOption[]>(`/admin/promotions/offers?q=${encodeURIComponent(q)}`),
      ),
    );
    if (err) setMsg({ tone: 'error', text: err });
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const price = rupeesToPaise(form.price);
    if (!offer || !price) {
      setMsg({ tone: 'error', text: 'Pick an offer and enter a deal price' });
      return;
    }
    const err = await attempt(() =>
      api('/admin/promotions/deals', {
        method: 'POST',
        json: {
          offerId: offer.offerId,
          title: form.title || undefined,
          dealPricePaise: price,
          quantityCap: Number(form.cap),
          startsAt: fromLocalInput(form.starts),
          endsAt: fromLocalInput(form.ends),
        },
      }),
    );
    setMsg(err ? { tone: 'error', text: err } : { tone: 'ok', text: 'Lightning deal created' });
    if (!err) {
      setOffer(null);
      setOptions([]);
    }
    await deals.reload();
  };

  const toggle = async (d: LightningDealView) => {
    const err = await attempt(() =>
      api(`/admin/promotions/deals/${d.id}`, { method: 'PUT', json: { active: !d.active } }),
    );
    if (err) setMsg({ tone: 'error', text: err });
    await deals.reload();
  };

  return (
    <>
      <SectionCard title="New lightning deal">
        <div className="mb-3 flex gap-2">
          <input
            aria-label="Find product offer"
            placeholder="Find product offer"
            className="h-10 flex-1 rounded border px-3 text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void find();
              }
            }}
          />
          <Button variant="secondary" onClick={() => void find()}>
            Find
          </Button>
        </div>
        {options.length > 0 && !offer && (
          <ul aria-label="Offers" className="mb-3 divide-y rounded border text-sm">
            {options.map((o) => (
              <li key={o.offerId}>
                <button
                  type="button"
                  className="flex w-full justify-between px-3 py-2 text-left hover:bg-slate-50"
                  onClick={() => {
                    setOffer(o);
                    setForm({ ...form, title: o.title });
                  }}
                >
                  <span>
                    {o.title} <span className="text-slate-500">· {o.sellerName}</span>
                  </span>
                  <span>
                    {formatPaise(o.pricePaise)} · {o.availableQty} in stock
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {offer && (
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-3">
            <p className="text-sm sm:col-span-3">
              Offer: <strong>{offer.title}</strong> by {offer.sellerName}, now{' '}
              {formatPaise(offer.pricePaise)} (MRP {formatPaise(offer.mrpPaise)}){' '}
              <button type="button" className={linkButton} onClick={() => setOffer(null)}>
                change
              </button>
            </p>
            <Field
              label="Deal title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <Field
              label="Deal price (₹)"
              required
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <Field
              label="Quantity cap"
              required
              type="number"
              min={1}
              value={form.cap}
              onChange={(e) => setForm({ ...form, cap: e.target.value })}
            />
            <Field
              label="Starts"
              required
              type="datetime-local"
              value={form.starts}
              onChange={(e) => setForm({ ...form, starts: e.target.value })}
            />
            <Field
              label="Ends"
              required
              type="datetime-local"
              value={form.ends}
              onChange={(e) => setForm({ ...form, ends: e.target.value })}
            />
            <div className="flex items-end">
              <Button type="submit">Create deal</Button>
            </div>
          </form>
        )}
        {msg && (
          <div className="mt-3">
            <Alert tone={msg.tone}>{msg.text}</Alert>
          </div>
        )}
      </SectionCard>
      <SectionCard title="Lightning deals">
        <Table
          label="Lightning deals"
          head={['Deal', 'Price', 'Window', 'Claimed', 'Status', '']}
          rows={(deals.data ?? []).map((d) => ({
            key: d.id,
            cells: [
              d.title,
              formatPaise(d.dealPricePaise),
              `${when(d.startsAt)} → ${when(d.endsAt)}`,
              <div key="c" className="w-36">
                <ProgressBar value={d.claimedPercent} label={`${d.claimedPercent}% claimed`} />
                <span className="text-xs text-slate-600">
                  {d.claimedQty}/{d.quantityCap} ({d.claimedPercent}%)
                </span>
              </div>,
              <StatusPill key="s" status={d.active ? 'ACTIVE' : 'PAUSED'} />,
              <button key="t" type="button" className={linkButton} onClick={() => void toggle(d)}>
                {d.active ? 'Pause' : 'Resume'}
              </button>,
            ],
          }))}
        />
      </SectionCard>
    </>
  );
}

function Coupons() {
  const coupons = useLoad<AdminCoupon[]>('/admin/promotions/coupons');
  const [form, setForm] = useState({
    code: '',
    description: '',
    type: 'PERCENT' as 'PERCENT' | 'FLAT',
    value: '10',
    min: '0',
    max: '',
    perUser: '1',
    total: '',
    starts: hourFromNow(0),
    ends: hourFromNow(24 * 7),
  });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const payload = (c: typeof form, active = true) => ({
    code: c.code,
    description: c.description,
    type: c.type,
    value: c.type === 'PERCENT' ? Math.round(Number(c.value) * 100) : (rupeesToPaise(c.value) ?? 0),
    minOrderPaise: rupeesToPaise(c.min || '0') ?? 0,
    maxDiscountPaise: c.max ? rupeesToPaise(c.max) : null,
    perUserLimit: Number(c.perUser),
    totalLimit: c.total ? Number(c.total) : null,
    startsAt: fromLocalInput(c.starts),
    endsAt: fromLocalInput(c.ends),
    active,
  });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const err = await attempt(() =>
      api('/admin/promotions/coupons', { method: 'POST', json: payload(form) }),
    );
    setMsg(err ? { tone: 'error', text: err } : { tone: 'ok', text: 'Coupon created' });
    await coupons.reload();
  };

  const toggle = async (c: AdminCoupon) => {
    const err = await attempt(() =>
      api(`/admin/promotions/coupons/${c.id}`, {
        method: 'PUT',
        json: { ...c, id: undefined, usedCount: undefined, active: !c.active },
      }),
    );
    if (err) setMsg({ tone: 'error', text: err });
    await coupons.reload();
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <SectionCard title="New coupon">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-4">
          <Field label="Code" required value={form.code} onChange={set('code')} />
          <Field
            label="Description"
            value={form.description}
            onChange={set('description')}
            className="sm:col-span-3"
          />
          <label className="text-sm font-medium text-slate-700">
            Type
            <select
              className="mt-1 block h-10 w-full rounded border px-2"
              value={form.type}
              onChange={set('type')}
            >
              <option value="PERCENT">Percent off</option>
              <option value="FLAT">Flat ₹ off</option>
            </select>
          </label>
          <Field
            label={form.type === 'PERCENT' ? 'Percent' : 'Amount (₹)'}
            required
            value={form.value}
            onChange={set('value')}
          />
          <Field label="Min order (₹)" value={form.min} onChange={set('min')} />
          <Field label="Max discount (₹)" value={form.max} onChange={set('max')} />
          <Field
            label="Uses per customer"
            type="number"
            min={1}
            value={form.perUser}
            onChange={set('perUser')}
          />
          <Field label="Total uses (blank = no limit)" value={form.total} onChange={set('total')} />
          <Field
            label="Starts"
            type="datetime-local"
            required
            value={form.starts}
            onChange={set('starts')}
          />
          <Field
            label="Ends"
            type="datetime-local"
            required
            value={form.ends}
            onChange={set('ends')}
          />
          <div className="flex items-end">
            <Button type="submit">Create coupon</Button>
          </div>
        </form>
        {msg && (
          <div className="mt-3">
            <Alert tone={msg.tone}>{msg.text}</Alert>
          </div>
        )}
      </SectionCard>
      <SectionCard title="Coupons">
        <Table
          label="Coupons"
          head={['Code', 'Discount', 'Used', 'Window', 'Status', '']}
          rows={(coupons.data ?? []).map((c) => ({
            key: c.id,
            cells: [
              <code key="c">{c.code}</code>,
              c.type === 'PERCENT' ? `${c.value / 100}%` : formatPaise(c.value),
              `${c.usedCount}${c.totalLimit ? `/${c.totalLimit}` : ''}`,
              `${when(c.startsAt)} → ${when(c.endsAt)}`,
              <StatusPill key="s" status={c.active ? 'ACTIVE' : 'PAUSED'} />,
              <button key="t" type="button" className={linkButton} onClick={() => void toggle(c)}>
                {c.active ? 'Pause' : 'Resume'}
              </button>,
            ],
          }))}
        />
      </SectionCard>
    </>
  );
}

function BankOffers() {
  const offers = useLoad<BankOfferView[]>('/admin/promotions/bank-offers');
  const [form, setForm] = useState({
    title: '10% off with ShopSphere Bank cards',
    percent: '10',
    max: '1500',
    min: '0',
    starts: hourFromNow(0),
    ends: hourFromNow(24 * 30),
  });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const body = (o: typeof form, active: boolean) => ({
    title: o.title,
    percentBp: Math.round(Number(o.percent) * 100),
    maxDiscountPaise: o.max ? rupeesToPaise(o.max) : null,
    minOrderPaise: rupeesToPaise(o.min || '0') ?? 0,
    startsAt: fromLocalInput(o.starts),
    endsAt: fromLocalInput(o.ends),
    active,
  });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const err = await attempt(() =>
      api('/admin/promotions/bank-offers', { method: 'POST', json: body(form, true) }),
    );
    setMsg(err ? { tone: 'error', text: err } : { tone: 'ok', text: 'Bank offer created' });
    await offers.reload();
  };

  const toggle = async (o: BankOfferView) => {
    const err = await attempt(() =>
      api(`/admin/promotions/bank-offers/${o.id}`, {
        method: 'PUT',
        json: {
          title: o.title,
          percentBp: o.percentBp,
          maxDiscountPaise: o.maxDiscountPaise,
          minOrderPaise: o.minOrderPaise,
          startsAt: o.startsAt,
          endsAt: o.endsAt,
          active: !o.active,
        },
      }),
    );
    if (err) setMsg({ tone: 'error', text: err });
    await offers.reload();
  };

  return (
    <>
      <SectionCard title="New bank offer">
        <p className="mb-3 text-sm text-slate-600">
          Applied at checkout only when the shopper pays with ShopSphere Bank.
        </p>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Title"
            required
            value={form.title}
            onChange={set('title')}
            className="sm:col-span-3"
          />
          <Field label="Percent off" required value={form.percent} onChange={set('percent')} />
          <Field label="Max discount (₹)" value={form.max} onChange={set('max')} />
          <Field label="Min order (₹)" value={form.min} onChange={set('min')} />
          <Field
            label="Starts"
            type="datetime-local"
            required
            value={form.starts}
            onChange={set('starts')}
          />
          <Field
            label="Ends"
            type="datetime-local"
            required
            value={form.ends}
            onChange={set('ends')}
          />
          <div className="flex items-end">
            <Button type="submit">Create offer</Button>
          </div>
        </form>
        {msg && (
          <div className="mt-3">
            <Alert tone={msg.tone}>{msg.text}</Alert>
          </div>
        )}
      </SectionCard>
      <SectionCard title="Bank offers">
        <Table
          label="Bank offers"
          head={['Offer', 'Discount', 'Window', 'Status', '']}
          rows={(offers.data ?? []).map((o) => ({
            key: o.id,
            cells: [
              o.title,
              `${o.percentBp / 100}%${o.maxDiscountPaise ? ` up to ${formatPaise(o.maxDiscountPaise)}` : ''}`,
              `${when(o.startsAt)} → ${when(o.endsAt)}`,
              <StatusPill key="s" status={o.active ? 'ACTIVE' : 'PAUSED'} />,
              <button key="t" type="button" className={linkButton} onClick={() => void toggle(o)}>
                {o.active ? 'Pause' : 'Resume'}
              </button>,
            ],
          }))}
        />
      </SectionCard>
    </>
  );
}
