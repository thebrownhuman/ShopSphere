import { COD_MAX_PAISE, codVerdict, riskScore } from './cod';
import { ONE_DAY_FEE_PAISE, splitShipments, type SplitLine } from './shipments';

const now = new Date('2026-10-28T04:00:00Z'); // Wed 09:30 IST

const line = (o: Partial<SplitLine>): SplitLine => ({
  key: 'k',
  sellerId: 's1',
  sellerName: 'Seller 1',
  sellerPincode: '560001',
  cutoffHour: 14,
  fulfilledByShopSphere: false,
  categoryPath: 'electronics/phones',
  lineTotalPaise: 10_000,
  ...o,
});

describe('shipment split (M4.5)', () => {
  it('groups by seller with per-shipment options and fees', () => {
    const out = splitShipments(
      [
        line({ key: 'a' }),
        line({ key: 'b', sellerId: 's2', fulfilledByShopSphere: true }),
        line({ key: 'c' }),
      ],
      '560034',
      [{ shipmentKey: 's:s2', type: 'ONE_DAY' }],
      now,
    );
    expect(out.map((s) => [s.sellerId, s.lines.length])).toEqual([
      ['s1', 2],
      ['s2', 1],
    ]);
    expect(out[0].deliveryFeePaise).toBe(4_000); // items under the free threshold, seller-fulfilled
    expect(out[0].options.map((o) => o.type)).toEqual(['STANDARD']);
    expect(out[1].selected.type).toBe('ONE_DAY');
    expect(out[1].deliveryFeePaise).toBe(ONE_DAY_FEE_PAISE);
  });

  it('standard is free above the threshold and scheduled slots exist for grocery', () => {
    const g = line({ lineTotalPaise: 60_000, categoryPath: 'grocery/staples' });
    const [s] = splitShipments([g], '560034', [], now);
    expect(s.deliveryFeePaise).toBe(0);
    const sched = s.options.find((o) => o.type === 'SCHEDULED');
    expect(sched?.slots?.length).toBeGreaterThan(1);
    const slot = sched!.slots![1];
    const [picked] = splitShipments(
      [g],
      '560034',
      [{ shipmentKey: 's:s1', type: 'SCHEDULED', slotDate: slot }],
      now,
    );
    expect(picked.deliveryDate).toBe(slot);
  });

  it('falls back to standard when the chosen option is unavailable', () => {
    const [s] = splitShipments(
      [line({})],
      '744101',
      [{ shipmentKey: 's:s1', type: 'ONE_DAY' }],
      now,
    );
    expect(s.selected.type).toBe('STANDARD');
  });
});

describe('COD rules (M4.19)', () => {
  const ok = { payablePaise: 100_000, pincode: '560034', pincodeServiceable: true, risk: 0 };

  it('limits amount, pincode and risk', () => {
    expect(codVerdict(ok).available).toBe(true);
    expect(codVerdict({ ...ok, payablePaise: COD_MAX_PAISE + 1 }).reason).toBe('COD_LIMIT');
    expect(codVerdict({ ...ok, pincode: '744101' }).reason).toBe('COD_PINCODE');
    expect(codVerdict({ ...ok, pincodeServiceable: false }).reason).toBe('COD_PINCODE');
    expect(codVerdict({ ...ok, risk: 80 }).reason).toBe('COD_RISK');
  });

  it('scores high-value first orders plus velocity as risky', () => {
    expect(riskScore({ priorOrders: 5, ordersLastHour: 0, totalPaise: 100_000 })).toBe(0);
    expect(
      riskScore({ priorOrders: 0, ordersLastHour: 3, totalPaise: 2_000_000 }),
    ).toBeGreaterThanOrEqual(70);
  });
});
