import { evaluateCoupon, type CouponDef, type CouponLine } from './coupon-engine';

const now = new Date('2026-10-31T10:00:00Z');
const base: CouponDef = {
  code: 'SAVE10',
  description: '10% off',
  type: 'PERCENT',
  value: 1000,
  minOrderPaise: 50_000,
  maxDiscountPaise: 20_000,
  perUserLimit: 1,
  totalLimit: null,
  usedCount: 0,
  categoryIds: [],
  sellerIds: [],
  startsAt: new Date('2026-10-01T00:00:00Z'),
  endsAt: new Date('2026-12-01T00:00:00Z'),
  active: true,
};
const lines: CouponLine[] = [
  { key: 'a', sellerId: 's1', categoryIds: ['phones', 'electronics'], lineTotalPaise: 100_000 },
  { key: 'b', sellerId: 's2', categoryIds: ['books'], lineTotalPaise: 50_000 },
];
const run = (c: Partial<CouponDef> | null, userRedemptions = 0) =>
  evaluateCoupon(c && { ...base, ...c }, { now, userRedemptions, lines });

describe('coupon engine (M4.6)', () => {
  it('applies percent with max-discount cap and allocates pro rata', () => {
    const r = run({});
    expect(r.ok && r.discountPaise).toBe(15_000);
    const capped = run({ value: 5000 });
    expect(capped.ok && capped.discountPaise).toBe(20_000);
    if (capped.ok) expect([...capped.allocation.values()].reduce((a, b) => a + b, 0)).toBe(20_000);
  });

  it('applies flat, never above the eligible total', () => {
    const r = run({ type: 'FLAT', value: 500_000, maxDiscountPaise: null, minOrderPaise: 0 });
    expect(r.ok && r.discountPaise).toBe(150_000);
  });

  it('enforces validity window, per-user and total limits', () => {
    expect(run({ startsAt: new Date('2026-11-01') })).toMatchObject({
      ok: false,
      code: 'COUPON_NOT_STARTED',
    });
    expect(run({ endsAt: now })).toMatchObject({ ok: false, code: 'COUPON_EXPIRED' });
    expect(run({}, 1)).toMatchObject({ ok: false, code: 'COUPON_USAGE_LIMIT' });
    expect(run({ totalLimit: 5, usedCount: 5 })).toMatchObject({
      ok: false,
      code: 'COUPON_USAGE_LIMIT',
    });
    expect(run(null)).toMatchObject({ ok: false, code: 'COUPON_NOT_FOUND' });
    expect(run({ active: false })).toMatchObject({ ok: false, code: 'COUPON_NOT_FOUND' });
  });

  it('scopes by category ancestors and seller; min order counts eligible lines only', () => {
    const r = run({ categoryIds: ['electronics'], minOrderPaise: 0 });
    expect(r.ok && [...r.allocation.keys()]).toEqual(['a']);
    expect(run({ sellerIds: ['s9'] })).toMatchObject({ ok: false, code: 'COUPON_NOT_APPLICABLE' });
    expect(run({ categoryIds: ['books'], minOrderPaise: 60_000 })).toMatchObject({
      ok: false,
      code: 'COUPON_MIN_ORDER',
    });
  });
});
