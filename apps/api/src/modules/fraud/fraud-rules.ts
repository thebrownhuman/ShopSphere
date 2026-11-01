/**
 * Fraud scoring v1 (M7.2, PRD §9): deterministic rules → 0–100 score → decision.
 * Pure so every rule and threshold is unit-tested; FraudService gathers the facts.
 */

export interface FraudThresholds {
  forcePrepaidScore: number;
  reviewScore: number;
  captchaScore: number;
  highValuePaise: number;
  newAccountDays: number;
  userOrdersPerHour: number;
  deviceOrdersPerHour: number;
  deviceUsersPerDay: number;
  ipOrdersPerHour: number;
}

export interface FraudFacts {
  paymentMethod: 'ONLINE' | 'COD' | 'STORE_BALANCE';
  totalPaise: number;
  /** Orders this user placed before this one (any status). */
  priorOrders: number;
  accountAgeDays: number;
  userOrdersLastHour: number;
  /** Null when the request carried no device cookie (fingerprint missing). */
  deviceId: string | null;
  deviceOrdersLastHour: number;
  /** Distinct accounts that placed orders from this device in 24 h (including this one). */
  deviceUsersLastDay: number;
  ipOrdersLastHour: number;
  /** State of the account's default (billing) address; null when none on file. */
  billingState: string | null;
  shippingState: string;
}

export type FraudSignalCode =
  | 'USER_VELOCITY'
  | 'USER_VELOCITY_BURST'
  | 'DEVICE_VELOCITY'
  | 'DEVICE_SHARED'
  | 'DEVICE_MISSING'
  | 'IP_VELOCITY'
  | 'HIGH_VALUE_FIRST_ORDER'
  | 'VERY_HIGH_VALUE'
  | 'ADDRESS_MISMATCH'
  | 'COD_NEW_ACCOUNT';

export interface FraudSignal {
  code: FraudSignalCode;
  points: number;
  detail: string;
}

export type FraudDecision = 'ALLOW' | 'FORCE_PREPAID' | 'MANUAL_REVIEW' | 'CHALLENGE';

export interface FraudResult {
  score: number;
  signals: FraudSignal[];
  /** COD must be refused (customer may still pay online). */
  forcePrepaid: boolean;
  /** Order is created but held for staff review before fulfilment. */
  manualReview: boolean;
  /** Bot protection: a Turnstile token is required to proceed. */
  challenge: boolean;
}

export const DEFAULT_THRESHOLDS: FraudThresholds = {
  forcePrepaidScore: 50,
  reviewScore: 80,
  captchaScore: 60,
  highValuePaise: 1_000_000,
  newAccountDays: 7,
  userOrdersPerHour: 3,
  deviceOrdersPerHour: 5,
  deviceUsersPerDay: 3,
  ipOrdersPerHour: 15,
};

const VELOCITY_CODES: ReadonlySet<FraudSignalCode> = new Set([
  'USER_VELOCITY',
  'USER_VELOCITY_BURST',
  'DEVICE_VELOCITY',
  'DEVICE_SHARED',
  'IP_VELOCITY',
]);

export function scoreOrder(f: FraudFacts, t: FraudThresholds = DEFAULT_THRESHOLDS): FraudResult {
  const signals: FraudSignal[] = [];
  const add = (code: FraudSignalCode, points: number, detail: string) =>
    signals.push({ code, points, detail });

  if (f.userOrdersLastHour >= t.userOrdersPerHour * 2)
    add('USER_VELOCITY_BURST', 45, `${f.userOrdersLastHour} orders by this account in 1 h`);
  else if (f.userOrdersLastHour >= t.userOrdersPerHour)
    add('USER_VELOCITY', 25, `${f.userOrdersLastHour} orders by this account in 1 h`);
  if (f.deviceId === null) add('DEVICE_MISSING', 10, 'No device fingerprint on the request');
  else {
    if (f.deviceOrdersLastHour >= t.deviceOrdersPerHour)
      add('DEVICE_VELOCITY', 25, `${f.deviceOrdersLastHour} orders from this device in 1 h`);
    if (f.deviceUsersLastDay >= t.deviceUsersPerDay)
      add('DEVICE_SHARED', 30, `${f.deviceUsersLastDay} accounts ordered from this device in 24 h`);
  }
  if (f.ipOrdersLastHour >= t.ipOrdersPerHour)
    add('IP_VELOCITY', 20, `${f.ipOrdersLastHour} orders from this IP in 1 h`);
  if (f.priorOrders === 0 && f.totalPaise >= t.highValuePaise)
    add('HIGH_VALUE_FIRST_ORDER', 35, `First order worth ₹${Math.round(f.totalPaise / 100)}`);
  if (f.totalPaise >= t.highValuePaise * 2.5) add('VERY_HIGH_VALUE', 10, 'Very high order value');
  if (
    f.billingState &&
    f.billingState.trim().toLowerCase() !== f.shippingState.trim().toLowerCase()
  )
    add('ADDRESS_MISMATCH', 15, `Billing ${f.billingState} ≠ shipping ${f.shippingState}`);
  if (f.paymentMethod === 'COD' && f.accountAgeDays < t.newAccountDays)
    add('COD_NEW_ACCOUNT', 20, `COD on an account ${f.accountAgeDays} day(s) old`);

  const score = Math.min(
    100,
    signals.reduce((sum, s) => sum + s.points, 0),
  );
  return {
    score,
    signals,
    forcePrepaid: f.paymentMethod === 'COD' && score >= t.forcePrepaidScore,
    manualReview: f.paymentMethod !== 'COD' && score >= t.reviewScore,
    challenge: score >= t.captchaScore && signals.some((s) => VELOCITY_CODES.has(s.code)),
  };
}

/** The single decision recorded on the assessment row (most restrictive outcome). */
export function decisionOf(r: FraudResult): FraudDecision {
  if (r.forcePrepaid) return 'FORCE_PREPAID';
  if (r.manualReview) return 'MANUAL_REVIEW';
  if (r.challenge) return 'CHALLENGE';
  return 'ALLOW';
}
