import { pickBankOffer, type BankOfferDef } from './bank-offer';

const now = new Date('2026-11-01T10:00:00Z');
const offer = (o: Partial<BankOfferDef> = {}): BankOfferDef => ({
  id: 'o1',
  title: '10% off with ShopSphere Bank cards',
  provider: 'bank',
  percentBp: 1000,
  maxDiscountPaise: null,
  minOrderPaise: 0,
  startsAt: new Date('2026-01-01T00:00:00Z'),
  endsAt: new Date('2027-01-01T00:00:00Z'),
  active: true,
  ...o,
});

describe('pickBankOffer (M6.6)', () => {
  it('applies to ShopSphere Bank payments', () => {
    expect(pickBankOffer([offer()], { type: 'ONLINE', provider: 'bank' }, 100_000, now)).toEqual({
      id: 'o1',
      title: '10% off with ShopSphere Bank cards',
      discountPaise: 10_000,
    });
  });

  it.each([
    ['Razorpay', { type: 'ONLINE' as const, provider: 'razorpay' }],
    ['COD', { type: 'COD' as const }],
    ['no method', null],
  ])('never applies to %s', (_, payment) => {
    expect(pickBankOffer([offer()], payment, 100_000, now)).toBeNull();
  });

  it('respects cap, minimum order, window and active flag', () => {
    const bank = { type: 'ONLINE' as const, provider: 'bank' };
    expect(
      pickBankOffer([offer({ maxDiscountPaise: 5_000 })], bank, 100_000, now)?.discountPaise,
    ).toBe(5_000);
    expect(pickBankOffer([offer({ minOrderPaise: 200_000 })], bank, 100_000, now)).toBeNull();
    expect(pickBankOffer([offer({ endsAt: now })], bank, 100_000, now)).toBeNull();
    expect(pickBankOffer([offer({ active: false })], bank, 100_000, now)).toBeNull();
  });

  it('picks the biggest discount', () => {
    const bank = { type: 'ONLINE' as const, provider: 'bank' };
    const best = pickBankOffer(
      [offer(), offer({ id: 'o2', percentBp: 1500, maxDiscountPaise: 12_000 })],
      bank,
      100_000,
      now,
    );
    expect(best).toMatchObject({ id: 'o2', discountPaise: 12_000 });
  });
});
