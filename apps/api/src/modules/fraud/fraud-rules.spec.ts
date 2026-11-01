import { DEFAULT_THRESHOLDS, decisionOf, scoreOrder, type FraudFacts } from './fraud-rules';

const clean: FraudFacts = {
  paymentMethod: 'ONLINE',
  totalPaise: 150_000,
  priorOrders: 4,
  accountAgeDays: 400,
  userOrdersLastHour: 0,
  deviceId: 'dev-abcdefghijklmnop',
  deviceOrdersLastHour: 0,
  deviceUsersLastDay: 1,
  ipOrdersLastHour: 0,
  billingState: 'Karnataka',
  shippingState: 'Karnataka',
};

const codes = (f: Partial<FraudFacts>) => scoreOrder({ ...clean, ...f }).signals.map((s) => s.code);

describe('fraud rules v1', () => {
  it('a regular order scores 0 and is allowed', () => {
    const r = scoreOrder(clean);
    expect(r.score).toBe(0);
    expect(decisionOf(r)).toBe('ALLOW');
  });

  it('order velocity per user: threshold, then burst', () => {
    expect(codes({ userOrdersLastHour: 2 })).toEqual([]);
    expect(codes({ userOrdersLastHour: 3 })).toEqual(['USER_VELOCITY']);
    expect(codes({ userOrdersLastHour: 6 })).toEqual(['USER_VELOCITY_BURST']);
  });

  it('device fingerprint: missing, velocity, shared across accounts', () => {
    expect(codes({ deviceId: null })).toEqual(['DEVICE_MISSING']);
    expect(codes({ deviceOrdersLastHour: 5 })).toEqual(['DEVICE_VELOCITY']);
    expect(codes({ deviceUsersLastDay: 3 })).toEqual(['DEVICE_SHARED']);
    // Device counters are ignored when there is no fingerprint at all.
    expect(codes({ deviceId: null, deviceUsersLastDay: 9 })).toEqual(['DEVICE_MISSING']);
  });

  it('order velocity per IP', () => {
    expect(codes({ ipOrdersLastHour: 14 })).toEqual([]);
    expect(codes({ ipOrdersLastHour: 15 })).toEqual(['IP_VELOCITY']);
  });

  it('high-value first order (and very high value)', () => {
    expect(codes({ priorOrders: 0, totalPaise: 999_999 })).toEqual([]);
    expect(codes({ priorOrders: 0, totalPaise: 1_000_000 })).toEqual(['HIGH_VALUE_FIRST_ORDER']);
    expect(codes({ priorOrders: 3, totalPaise: 2_500_000 })).toEqual(['VERY_HIGH_VALUE']);
  });

  it('billing/shipping state mismatch (case-insensitive)', () => {
    expect(codes({ shippingState: 'karnataka ' })).toEqual([]);
    expect(codes({ shippingState: 'Maharashtra' })).toEqual(['ADDRESS_MISMATCH']);
    expect(codes({ billingState: null, shippingState: 'Maharashtra' })).toEqual([]);
  });

  it('COD on a new account', () => {
    expect(codes({ paymentMethod: 'COD', accountAgeDays: 2 })).toEqual(['COD_NEW_ACCOUNT']);
    expect(codes({ paymentMethod: 'ONLINE', accountAgeDays: 2 })).toEqual([]);
    expect(codes({ paymentMethod: 'COD', accountAgeDays: 7 })).toEqual([]);
  });

  it('high-risk COD is forced to prepaid', () => {
    // 35 (high-value first) + 20 (COD new account) = 55 ≥ 50
    const r = scoreOrder({
      ...clean,
      paymentMethod: 'COD',
      priorOrders: 0,
      accountAgeDays: 0,
      totalPaise: 1_200_000,
    });
    expect(r.score).toBe(55);
    expect(r.forcePrepaid).toBe(true);
    expect(r.manualReview).toBe(false);
    expect(decisionOf(r)).toBe('FORCE_PREPAID');
  });

  it('very high risk prepaid order goes to manual review', () => {
    // 35 + 15 + 30 = 80
    const r = scoreOrder({
      ...clean,
      priorOrders: 0,
      totalPaise: 1_200_000,
      shippingState: 'Maharashtra',
      deviceUsersLastDay: 4,
    });
    expect(r.score).toBe(80);
    expect(r.manualReview).toBe(true);
    expect(r.forcePrepaid).toBe(false);
    expect(decisionOf(r)).toBe('MANUAL_REVIEW');
  });

  it('velocity-driven risk asks for a captcha; value-only risk does not', () => {
    expect(scoreOrder({ ...clean, userOrdersLastHour: 6, deviceOrdersLastHour: 6 }).challenge).toBe(
      true,
    );
    expect(
      scoreOrder({ ...clean, priorOrders: 0, totalPaise: 3_000_000, shippingState: 'Goa' })
        .challenge,
    ).toBe(false);
  });

  it('thresholds are configurable', () => {
    const t = { ...DEFAULT_THRESHOLDS, reviewScore: 20, userOrdersPerHour: 1 };
    const r = scoreOrder({ ...clean, userOrdersLastHour: 1 }, t);
    expect(r.score).toBe(25);
    expect(r.manualReview).toBe(true);
  });

  it('score is capped at 100', () => {
    const r = scoreOrder({
      ...clean,
      paymentMethod: 'COD',
      priorOrders: 0,
      accountAgeDays: 0,
      totalPaise: 9_000_000,
      userOrdersLastHour: 10,
      deviceOrdersLastHour: 10,
      deviceUsersLastDay: 10,
      ipOrdersLastHour: 50,
      shippingState: 'Goa',
    });
    expect(r.score).toBe(100);
  });
});
