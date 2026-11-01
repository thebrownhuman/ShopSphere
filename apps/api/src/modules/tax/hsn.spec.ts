import { DEFAULT_HSN, resolveHsn } from './hsn';

describe('resolveHsn', () => {
  it('prefers the most specific mapped category', () => {
    expect(resolveHsn(['laptops', 'electronics'])).toBe('8471');
  });
  it('falls back to the root, then to the default', () => {
    expect(resolveHsn(['unknown-leaf', 'books'])).toBe('4901');
    expect(resolveHsn(['nothing'])).toBe(DEFAULT_HSN);
  });
});
