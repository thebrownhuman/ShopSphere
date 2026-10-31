import { aggregate, toHistogram } from './review-aggregate';
import { autoFlagReason, displayName } from './review-moderation';

describe('review aggregate math', () => {
  it('is zero with no reviews', () => {
    expect(aggregate([0, 0, 0, 0, 0])).toEqual({ ratingX10: 0, count: 0 });
  });

  it('averages to one decimal, rounding half up', () => {
    // (5+4)/2 = 4.5
    expect(aggregate([0, 0, 0, 1, 1])).toEqual({ ratingX10: 45, count: 2 });
    // (5+4+4+4)/4 = 4.25 → 4.3
    expect(aggregate([0, 0, 0, 3, 1])).toEqual({ ratingX10: 43, count: 4 });
    // (1+5+5)/3 = 3.666… → 3.7
    expect(aggregate([1, 0, 0, 0, 2])).toEqual({ ratingX10: 37, count: 3 });
    // (1+2)/2 = 1.5 → 15; 2/3 of 1s + 1/3 of 2s = 1.333 → 13
    expect(aggregate([1, 1, 0, 0, 0]).ratingX10).toBe(15);
    expect(aggregate([2, 1, 0, 0, 0]).ratingX10).toBe(13);
  });

  it('stays exact for large counts', () => {
    expect(aggregate([0, 0, 0, 0, 1_000_000])).toEqual({ ratingX10: 50, count: 1_000_000 });
    expect(aggregate([100_000, 0, 0, 0, 100_000]).ratingX10).toBe(30);
  });

  it('builds histograms from group rows and drops invalid stars', () => {
    expect(
      toHistogram([
        { rating: 5, count: 3 },
        { rating: 1, count: 2 },
        { rating: 0, count: 9 },
        { rating: 6, count: 9 },
      ]),
    ).toEqual([2, 0, 0, 0, 3]);
  });
});

describe('review moderation helpers', () => {
  it('flags links, contact details and blocked words', () => {
    expect(autoFlagReason('Great phone, buy at www.cheap.xyz')).toMatch(/link/);
    expect(autoFlagReason('call 9876543210 for deals')).toMatch(/contact/);
    expect(autoFlagReason('This is shit')).toMatch(/blocked/);
    expect(autoFlagReason('Battery lasts two days. Camera is 4.5/5.')).toBeNull();
  });

  it('shortens display names', () => {
    expect(displayName('Asha Verma')).toBe('Asha V.');
    expect(displayName('Ravi')).toBe('Ravi');
    expect(displayName(null)).toBe('ShopSphere Customer');
  });
});
