import { estimateDelivery, isValidPincode, slaDays, zoneFor } from './delivery-estimate';

describe('zoneFor', () => {
  it.each([
    ['110001', '110020', 'LOCAL'],
    ['400001', '401101', 'REGIONAL'],
    ['110001', '560001', 'METRO'],
    ['110001', '302001', 'NATIONAL'],
    ['110001', '744101', 'REMOTE'],
    ['560001', '781001', 'REMOTE'],
  ])('%s → %s is %s', (from, to, zone) => {
    expect(zoneFor(from, to)).toBe(zone);
  });
});

describe('slaDays', () => {
  it('gives ShopSphere fulfilment a day off, never below 1 and not to remote', () => {
    expect(slaDays('NATIONAL', false)).toBe(4);
    expect(slaDays('NATIONAL', true)).toBe(3);
    expect(slaDays('LOCAL', true)).toBe(1);
    expect(slaDays('REMOTE', true)).toBe(7);
  });
});

describe('isValidPincode', () => {
  it('accepts 6 digits not starting with 0', () => {
    expect(isValidPincode('560001')).toBe(true);
    expect(isValidPincode('060001')).toBe(false);
    expect(isValidPincode('56001')).toBe(false);
    expect(isValidPincode('56000a')).toBe(false);
  });
});

describe('estimateDelivery', () => {
  const base = {
    fromPin: '110001',
    toPin: '560001',
    fulfilledByShopSphere: false,
    cutoffHour: 14,
    pricePaise: 100_000,
  };

  it('before cutoff: dispatch today, countdown to today 14:00 IST', () => {
    // Tue 2026-10-27 10:00 IST = 04:30 UTC
    const e = estimateDelivery({ ...base, now: new Date('2026-10-27T04:30:00Z') });
    expect(e.zone).toBe('METRO');
    expect(e.cutoffAt.toISOString()).toBe('2026-10-27T08:30:00.000Z');
    expect(e.cutoffSecondsRemaining).toBe(4 * 3600);
    expect(e.deliveryDate).toBe('2026-10-29');
    expect(e).toMatchObject({ freeDelivery: true, deliveryFee: 0 });
  });

  it('after cutoff: dispatch tomorrow', () => {
    // Tue 2026-10-27 15:00 IST
    const e = estimateDelivery({ ...base, now: new Date('2026-10-27T09:30:00Z') });
    expect(e.cutoffAt.toISOString()).toBe('2026-10-28T08:30:00.000Z');
    expect(e.deliveryDate).toBe('2026-10-30');
  });

  it('uses the IST date near midnight UTC', () => {
    // 2026-10-27 23:30 UTC = Wed 2026-10-28 05:00 IST, before cutoff
    const e = estimateDelivery({ ...base, now: new Date('2026-10-27T23:30:00Z') });
    expect(e.cutoffAt.toISOString()).toBe('2026-10-28T08:30:00.000Z');
    expect(e.deliveryDate).toBe('2026-10-30');
  });

  it('skips Sunday deliveries', () => {
    // Fri 2026-10-30 10:00 IST + 2 days = Sun → Mon 2026-11-02
    const e = estimateDelivery({ ...base, now: new Date('2026-10-30T04:30:00Z') });
    expect(e.deliveryDate).toBe('2026-11-02');
  });

  it('charges a fee below the free threshold unless fulfilled by ShopSphere', () => {
    const now = new Date('2026-10-27T04:30:00Z');
    expect(estimateDelivery({ ...base, pricePaise: 29_900, now })).toMatchObject({
      freeDelivery: false,
      deliveryFee: 4_000,
    });
    expect(
      estimateDelivery({ ...base, pricePaise: 29_900, fulfilledByShopSphere: true, now }),
    ).toMatchObject({ freeDelivery: true, slaDays: 1 });
  });
});
