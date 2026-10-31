import {
  checkEligibility,
  DEFAULT_WINDOW_DAYS,
  pickupDates,
  returnTrackingApplies,
  windowDaysFor,
} from './return-policy';

const delivered = new Date('2026-11-01T06:00:00Z');
const days = (d: number) => new Date(delivered.getTime() + d * 86_400_000);

describe('return eligibility (M6.1)', () => {
  it('uses the window of the top-level category, default for unknown ones', () => {
    expect(windowDaysFor('electronics')).toBe(7);
    expect(windowDaysFor('fashion')).toBe(10);
    expect(windowDaysFor('grocery')).toBe(0);
    expect(windowDaysFor('garden-tools')).toBe(DEFAULT_WINDOW_DAYS);
    expect(windowDaysFor(null)).toBe(DEFAULT_WINDOW_DAYS);
  });

  it('is eligible inside the window and not after it', () => {
    const base = {
      orderStatus: 'DELIVERED',
      deliveredAt: delivered,
      itemRootSlugs: ['electronics'],
    };
    expect(checkEligibility({ ...base, now: days(6.9) })).toMatchObject({
      eligible: true,
      windowDays: 7,
      windowEndsAt: days(7),
    });
    expect(checkEligibility({ ...base, now: days(7.01) })).toMatchObject({
      eligible: false,
      reason: 'The return window has closed',
    });
  });

  it('takes the shortest window across items; a non-returnable item blocks the order', () => {
    const now = days(8);
    expect(
      checkEligibility({
        orderStatus: 'DELIVERED',
        deliveredAt: delivered,
        itemRootSlugs: ['fashion', 'home'],
        now,
      }).eligible,
    ).toBe(true);
    expect(
      checkEligibility({
        orderStatus: 'DELIVERED',
        deliveredAt: delivered,
        itemRootSlugs: ['fashion', 'books'],
        now,
      }).eligible,
    ).toBe(false);
    expect(
      checkEligibility({
        orderStatus: 'DELIVERED',
        deliveredAt: delivered,
        itemRootSlugs: ['fashion', 'grocery'],
        now: days(1),
      }),
    ).toMatchObject({ eligible: false, reason: 'Items in this order are not returnable' });
  });

  it('refuses orders that are not delivered (or already in a return)', () => {
    for (const orderStatus of ['SHIPPED', 'RETURN_REQUESTED', 'REFUNDED', 'CANCELLED']) {
      expect(
        checkEligibility({ orderStatus, deliveredAt: delivered, itemRootSlugs: [], now: days(1) }),
      ).toMatchObject({ eligible: false, reason: 'Only delivered orders can be returned' });
    }
  });

  it('offers the next three IST days for pickup', () => {
    // 20:00 UTC on 1 Nov is 01:30 IST on 2 Nov: first pickup day is 3 Nov.
    expect(pickupDates(new Date('2026-11-01T20:00:00Z'))).toEqual([
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
  });

  it('applies courier events forward only and freezes after receipt', () => {
    expect(returnTrackingApplies('PICKUP_SCHEDULED', 'PICKED_UP')).toBe(true);
    expect(returnTrackingApplies('PICKUP_SCHEDULED', 'RECEIVED')).toBe(true);
    expect(returnTrackingApplies('IN_TRANSIT', 'PICKED_UP')).toBe(false);
    expect(returnTrackingApplies('PICKED_UP', 'PICKED_UP')).toBe(false);
    expect(returnTrackingApplies('RECEIVED', 'RECEIVED')).toBe(false);
    expect(returnTrackingApplies('REFUNDED', 'RECEIVED')).toBe(false);
  });
});
