import { eligibleAt, pct, planPayouts, settle } from './settlement-math';

describe('settlement math', () => {
  it('rounds percentages half-up in integer paise', () => {
    expect(pct(10_000, 100)).toBe(100);
    expect(pct(150, 100)).toBe(2); // 1.5 → 2
    expect(pct(149, 100)).toBe(1); // 1.49 → 1
    expect(pct(0, 1_000)).toBe(0);
  });

  it('computes commission, fees GST, shipping, TCS 1% and TDS 0.1%', () => {
    // ₹1,180 item at 18% GST: taxable ₹1,000 + IGST ₹180. Courier ₹75, buyer paid ₹40 delivery.
    const s = settle({
      items: [{ taxablePaise: 100_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 18_000 }],
      courierCostPaise: 7_500,
      buyerDeliveryFeePaise: 4_000,
    });
    expect(s).toEqual({
      grossPaise: 118_000,
      taxablePaise: 100_000,
      commissionPaise: 11_800, // 10% of gross
      shippingFeePaise: 3_500, // 7500 − 4000
      feesGstPaise: 2_754, // 18% of (11800 + 3500) = 2754
      tcsPaise: 1_000, // 1% of taxable
      tdsPaise: 118, // 0.1% of gross
      netPaise: 118_000 - 11_800 - 3_500 - 2_754 - 1_000 - 118,
    });
    expect(s.netPaise).toBe(98_828);
  });

  it('sums multi-item shipments with CGST+SGST and never charges negative shipping', () => {
    const s = settle({
      items: [
        { taxablePaise: 50_000, cgstPaise: 2_500, sgstPaise: 2_500, igstPaise: 0 },
        { taxablePaise: 33_333, cgstPaise: 3_000, sgstPaise: 3_000, igstPaise: 0 },
      ],
      courierCostPaise: 3_500,
      buyerDeliveryFeePaise: 4_000,
    });
    expect(s.grossPaise).toBe(94_333);
    expect(s.taxablePaise).toBe(83_333);
    expect(s.shippingFeePaise).toBe(0);
    expect(s.tcsPaise).toBe(833);
    expect(s.tdsPaise).toBe(94);
    expect(s.commissionPaise).toBe(9_433);
    expect(s.feesGstPaise).toBe(1_698);
    expect(
      s.grossPaise -
        s.commissionPaise -
        s.shippingFeePaise -
        s.feesGstPaise -
        s.tcsPaise -
        s.tdsPaise,
    ).toBe(s.netPaise);
  });

  it('pays out T+7 after delivery', () => {
    expect(eligibleAt(new Date('2026-10-01T10:00:00Z')).toISOString()).toBe(
      '2026-10-08T10:00:00.000Z',
    );
  });

  it('batches due lines per seller, skipping not-yet-due and non-positive totals', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const due = new Date('2026-10-09T00:00:00Z');
    const later = new Date('2026-10-11T00:00:00Z');
    const plan = planPayouts(
      [
        { id: 'a1', sellerId: 'A', netPaise: 10_000, eligibleAt: due },
        { id: 'a2', sellerId: 'A', netPaise: 5_000, eligibleAt: now },
        { id: 'a3', sellerId: 'A', netPaise: 99_999, eligibleAt: later },
        { id: 'b1', sellerId: 'B', netPaise: 2_000, eligibleAt: due },
        { id: 'b2', sellerId: 'B', netPaise: -3_000, eligibleAt: due },
        { id: 'c1', sellerId: 'C', netPaise: 700, eligibleAt: due },
      ],
      now,
    );
    expect(plan).toEqual([
      { sellerId: 'A', amountPaise: 15_000, lineIds: ['a1', 'a2'] },
      { sellerId: 'C', amountPaise: 700, lineIds: ['c1'] },
    ]);
  });
});
