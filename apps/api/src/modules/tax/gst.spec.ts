import { isIntraState, lineTax, sumTax } from './gst';

describe('GST per line (M4.8)', () => {
  it('splits intra-state tax into CGST + SGST', () => {
    // Rs 1,180 incl. 18% GST: taxable Rs 1,000, tax Rs 180 -> 90 + 90.
    expect(lineTax(118_000, 1800, 'Karnataka', 'Karnataka')).toEqual({
      rateBp: 1800,
      taxablePaise: 100_000,
      cgstPaise: 9_000,
      sgstPaise: 9_000,
      igstPaise: 0,
    });
  });

  it('charges IGST inter-state', () => {
    expect(lineTax(118_000, 1800, 'Maharashtra', 'Karnataka')).toEqual({
      rateBp: 1800,
      taxablePaise: 100_000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 18_000,
    });
  });

  it('puts the odd paisa in SGST and never loses money to rounding', () => {
    const t = lineTax(99_999, 1200, 'Delhi', 'delhi ');
    expect(t.cgstPaise + t.sgstPaise + t.taxablePaise).toBe(99_999);
    expect(t.sgstPaise - t.cgstPaise).toBeLessThanOrEqual(1);
  });

  it('treats "&"/"and", case and whitespace as the same state', () => {
    expect(isIntraState('Jammu & Kashmir', 'jammu and  kashmir')).toBe(true);
  });

  it('handles 0% and zero amounts', () => {
    expect(lineTax(5_000, 0, 'A', 'B').igstPaise).toBe(0);
    expect(lineTax(0, 1800, 'A', 'A').taxablePaise).toBe(0);
  });

  it('sums mixed lines', () => {
    const s = sumTax([lineTax(118_000, 1800, 'A', 'A'), lineTax(118_000, 1800, 'B', 'A')]);
    expect(s).toEqual({
      cgstPaise: 9_000,
      sgstPaise: 9_000,
      igstPaise: 18_000,
      totalPaise: 36_000,
    });
  });
});
