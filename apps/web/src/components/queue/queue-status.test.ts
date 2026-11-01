import { describe, expect, it } from 'vitest';
import { safeNext } from './queue-status';

describe('safeNext', () => {
  it('keeps checkout paths with their query', () => {
    expect(safeNext('/checkout?buyNow=abc&qty=2')).toBe('/checkout?buyNow=abc&qty=2');
    expect(safeNext('/checkout')).toBe('/checkout');
  });

  it('falls back to /checkout for anything else (no open redirect)', () => {
    expect(safeNext(null)).toBe('/checkout');
    expect(safeNext('https://evil.example/checkout')).toBe('/checkout');
    expect(safeNext('//evil.example')).toBe('/checkout');
    expect(safeNext('/checkoutx')).toBe('/checkout');
  });
});
