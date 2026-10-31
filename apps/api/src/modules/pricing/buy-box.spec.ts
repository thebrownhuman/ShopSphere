import { BuyBoxCandidate, isBuyable, pickBuyBox, scoreOffers } from './buy-box';

const offer = (o: Partial<BuyBoxCandidate> & { id: string }): BuyBoxCandidate => ({
  price: 100_000n,
  stockQty: 10,
  reservedQty: 0,
  status: 'ACTIVE',
  sellerStatus: 'ACTIVE',
  sellerRatingX10: 40,
  isFirstParty: false,
  slaDays: 3,
  ...o,
});

describe('buy-box', () => {
  it('returns null with no buyable offers', () => {
    expect(pickBuyBox([])).toBeNull();
    expect(
      pickBuyBox([
        offer({ id: 'a', stockQty: 2, reservedQty: 2 }),
        offer({ id: 'b', status: 'INACTIVE' }),
        offer({ id: 'c', sellerStatus: 'SUSPENDED' }),
      ]),
    ).toBeNull();
  });

  it('prefers the cheaper offer when rating and speed match', () => {
    expect(pickBuyBox([offer({ id: 'a' }), offer({ id: 'b', price: 90_000n })])?.id).toBe('b');
  });

  it('lets a much better seller beat a marginally cheaper one', () => {
    const cheapPoor = offer({ id: 'cheap', price: 98_000n, sellerRatingX10: 25, slaDays: 6 });
    const goodFast = offer({ id: 'good', price: 100_000n, sellerRatingX10: 47, slaDays: 1 });
    expect(pickBuyBox([cheapPoor, goodFast])?.id).toBe('good');
  });

  it('keeps a far cheaper offer winning despite a lower rating', () => {
    const cheap = offer({ id: 'cheap', price: 60_000n, sellerRatingX10: 35 });
    const pricey = offer({ id: 'pricey', price: 100_000n, sellerRatingX10: 48 });
    expect(pickBuyBox([pricey, cheap])?.id).toBe('cheap');
  });

  it('breaks exact ties toward first party, then id', () => {
    expect(pickBuyBox([offer({ id: 'b' }), offer({ id: 'a', isFirstParty: true })])?.id).toBe('a');
    expect(pickBuyBox([offer({ id: 'z' }), offer({ id: 'y' })])?.id).toBe('y');
  });

  it('ignores out-of-stock offers even if cheapest and ranks the rest', () => {
    const ranked = scoreOffers([
      offer({ id: 'oos', price: 1_000n, stockQty: 0 }),
      offer({ id: 'x', price: 120_000n }),
      offer({ id: 'y', price: 100_000n }),
    ]);
    expect(ranked.map((r) => r.offer.id)).toEqual(['y', 'x']);
    expect(ranked[0].score).toBeLessThanOrEqual(1);
  });

  it('treats reserved stock as unavailable', () => {
    expect(isBuyable(offer({ id: 'a', stockQty: 3, reservedQty: 2 }))).toBe(true);
    expect(isBuyable(offer({ id: 'a', stockQty: 3, reservedQty: 3 }))).toBe(false);
  });
});
