import {
  gstinCheckChar,
  isValidIfsc,
  isValidPan,
  makeGstin,
  normalizeId,
  validateTaxIds,
} from './kyc-validation';

describe('KYC validation', () => {
  it('accepts well-formed PANs and rejects bad ones', () => {
    expect(isValidPan('ABCPE1234F')).toBe(true);
    expect(isValidPan('AAACR5055K')).toBe(true);
    expect(isValidPan('ABCXE1234F')).toBe(false); // X is not a holder type
    expect(isValidPan('ABCPE12345')).toBe(false);
    expect(isValidPan('abcpe1234f')).toBe(false);
    expect(isValidPan(normalizeId(' abcpe 1234f '))).toBe(true);
  });

  it('computes the GSTIN check character', () => {
    // Published sample GSTIN of Reliance Industries (Maharashtra).
    expect(gstinCheckChar('27AAACR5055K1Z')).toBe('7');
    expect(makeGstin('27', 'AAACR5055K')).toBe('27AAACR5055K1Z7');
  });

  it('passes a consistent PAN + GSTIN + pickup state', () => {
    const pan = 'ABCPE1234F';
    expect(validateTaxIds({ pan, gstin: makeGstin('29', pan), pickupState: 'Karnataka' })).toEqual(
      [],
    );
  });

  it('flags format, checksum, PAN mismatch and state mismatch', () => {
    const pan = 'ABCPE1234F';
    const good = makeGstin('27', pan);
    const badCheck = good.slice(0, 14) + (good[14] === 'A' ? 'B' : 'A');
    expect(validateTaxIds({ gstin: '27ABC' })[0].field).toBe('gstin');
    expect(validateTaxIds({ pan, gstin: badCheck }).map((i) => i.message)).toContain(
      'GSTIN check digit does not match',
    );
    expect(validateTaxIds({ pan: 'ZZZPE9999Z', gstin: good }).map((i) => i.message)).toContain(
      'GSTIN must contain your PAN',
    );
    expect(validateTaxIds({ pan, gstin: good, pickupState: 'Delhi' })[0].message).toMatch(
      /registered in Maharashtra/,
    );
    expect(validateTaxIds({ gstin: makeGstin('99', pan) })[0].message).toMatch(/Unknown GST state/);
    expect(validateTaxIds({ pan: 'BAD' })).toEqual([{ field: 'pan', message: expect.any(String) }]);
  });

  it('validates IFSC', () => {
    expect(isValidIfsc('SBIN0001234')).toBe(true);
    expect(isValidIfsc('SBIN1001234')).toBe(false);
    expect(isValidIfsc('SBI0001234')).toBe(false);
  });
});
