import { lineCap, planMerge, priceLine, summarise, type LiveOffer } from './cart-pricing';

const limits = { maxQtyPerItem: 10, freeDeliveryThreshold: 49_900 };
const offer = (o: Partial<LiveOffer> = {}): LiveOffer => ({
  price: 20_000,
  mrp: 25_000,
  available: 50,
  maxPerOrder: 5,
  active: true,
  ...o,
});

describe('cart pricing engine', () => {
  it('computes line totals from live prices, never the snapshot', () => {
    const r = priceLine({ qty: 2, snapshotPrice: 22_000, offer: offer(), serviceable: true }, limits);
    expect(r).toMatchObject({ unitPrice: 20_000, lineTotal: 40_000, maxQty: 5, inStock: true });
    expect(r.priceChange).toEqual({ from: 22_000, to: 20_000 });
    expect(r.stockChange).toBeNull();
  });

  it('flags limited stock and counts only purchasable units', () => {
    const r = priceLine(
      { qty: 4, snapshotPrice: 20_000, offer: offer({ available: 2 }), serviceable: true },
      limits,
    );
    expect(r).toMatchObject({ stockChange: 'LIMITED', purchasableQty: 2, lineTotal: 40_000 });
    expect(r.priceChange).toBeNull();
  });

  it('flags out of stock and unavailable offers with zero totals', () => {
    const oos = priceLine({ qty: 1, snapshotPrice: 1, offer: offer({ available: 0 }), serviceable: true }, limits);
    expect(oos).toMatchObject({ stockChange: 'OUT_OF_STOCK', lineTotal: 0, inStock: false });
    const gone = priceLine({ qty: 1, snapshotPrice: 1, offer: offer({ active: false }), serviceable: true }, limits);
    expect(gone).toMatchObject({ stockChange: 'UNAVAILABLE', unitPrice: 0, priceChange: null });
    expect(priceLine({ qty: 1, snapshotPrice: 1, offer: null, serviceable: true }, limits).stockChange).toBe(
      'UNAVAILABLE',
    );
  });

  it('excludes undeliverable lines from totals', () => {
    const r = priceLine({ qty: 1, snapshotPrice: 20_000, offer: offer(), serviceable: false }, limits);
    expect(r.lineTotal).toBe(0);
    expect(summarise([{ priced: r, serviceable: false }], limits).hasIssues).toBe(true);
  });

  it('caps at min(stock, max per order, cart limit)', () => {
    expect(lineCap(offer({ maxPerOrder: 50, available: 50 }), 10)).toBe(10);
    expect(lineCap(offer({ maxPerOrder: 3 }), 10)).toBe(3);
    expect(lineCap(offer({ available: -2 }), 10)).toBe(0);
  });

  it('summary: delivery fee below threshold, free at threshold, progress remaining', () => {
    const line = (price: number, qty = 1) => ({
      priced: priceLine({ qty, snapshotPrice: price, offer: offer({ price, mrp: price + 1_000 }), serviceable: true }, limits),
      serviceable: true,
    });
    const below = summarise([line(37_900)], limits);
    expect(below).toMatchObject({
      subtotal: 37_900,
      deliveryFee: 4_000,
      total: 41_900,
      freeDeliveryRemaining: 12_000,
      freeDeliveryEligible: false,
      savings: 1_000,
      itemCount: 1,
    });
    const at = summarise([line(24_950, 2)], limits);
    expect(at).toMatchObject({ subtotal: 49_900, deliveryFee: 0, freeDeliveryRemaining: 0, freeDeliveryEligible: true });
    expect(summarise([], limits)).toMatchObject({ subtotal: 0, deliveryFee: 0, total: 0 });
  });
});

describe('guest → user merge rules', () => {
  const lim = { maxLines: 3, maxQtyPerItem: 10 };

  it('sums matching lines and caps at the live limit', () => {
    const plan = planMerge(
      [{ id: 'u1', skuId: 'a', sellerId: 's', qty: 3 }],
      [{ skuId: 'a', sellerId: 's', qty: 4 }],
      () => 5,
      lim,
    );
    expect(plan.updates).toEqual([{ id: 'u1', qty: 5 }]);
    expect(plan.inserts).toEqual([]);
  });

  it("never lowers the user's own quantity", () => {
    const plan = planMerge(
      [{ id: 'u1', skuId: 'a', sellerId: 's', qty: 6 }],
      [{ skuId: 'a', sellerId: 's', qty: 2 }],
      () => 4,
      lim,
    );
    expect(plan.updates).toEqual([]);
  });

  it('treats the same SKU from another seller as a separate line', () => {
    const plan = planMerge(
      [{ id: 'u1', skuId: 'a', sellerId: 's1', qty: 1 }],
      [{ skuId: 'a', sellerId: 's2', qty: 2 }],
      () => 5,
      lim,
    );
    expect(plan.inserts).toEqual([{ skuId: 'a', sellerId: 's2', qty: 2 }]);
  });

  it('adds new lines up to the line limit and drops the rest', () => {
    const plan = planMerge(
      [{ id: 'u1', skuId: 'a', sellerId: 's', qty: 1 }],
      ['b', 'c', 'd'].map((skuId) => ({ skuId, sellerId: 's', qty: 12 })),
      () => 10,
      lim,
    );
    expect(plan.inserts.map((l) => [l.skuId, l.qty])).toEqual([
      ['b', 10],
      ['c', 10],
    ]);
    expect(plan.dropped.map((l) => l.skuId)).toEqual(['d']);
  });

  it('keeps unbuyable guest lines (capped at the item limit) so they show as unavailable', () => {
    const plan = planMerge([], [{ skuId: 'x', sellerId: 's', qty: 20 }], () => 0, lim);
    expect(plan.inserts).toEqual([{ skuId: 'x', sellerId: 's', qty: 10 }]);
  });
});
