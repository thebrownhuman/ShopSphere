/** What the simulated bank does with a payment. */
export type Behaviour = 'success' | 'fail' | 'pending' | 'late' | 'duplicate' | 'authorize';

export interface TestCard {
  number: string;
  network: string;
  type: 'debit' | 'credit';
  behaviour: Behaviour;
  note: string;
}

/** Magic test cards (all Luhn-valid). Any other Luhn-valid number succeeds. */
export const TEST_CARDS: TestCard[] = [
  {
    number: '4111111111111111',
    network: 'Visa',
    type: 'debit',
    behaviour: 'success',
    note: 'Captured',
  },
  {
    number: '5555555555554444',
    network: 'Mastercard',
    type: 'credit',
    behaviour: 'success',
    note: 'Captured',
  },
  {
    number: '6080000000000000',
    network: 'RuPay',
    type: 'debit',
    behaviour: 'success',
    note: 'Captured',
  },
  {
    number: '4000000000000002',
    network: 'Visa',
    type: 'credit',
    behaviour: 'fail',
    note: 'Declined by issuer',
  },
  {
    number: '4000000000000010',
    network: 'Visa',
    type: 'debit',
    behaviour: 'pending',
    note: 'Stays pending; resolve in /dev',
  },
  {
    number: '4000000000000028',
    network: 'Visa',
    type: 'credit',
    behaviour: 'late',
    note: 'Captured after a delay (late webhook)',
  },
  {
    number: '4000000000000036',
    network: 'Visa',
    type: 'debit',
    behaviour: 'duplicate',
    note: 'Charged twice (two captures)',
  },
  {
    number: '4000000000000044',
    network: 'Visa',
    type: 'credit',
    behaviour: 'authorize',
    note: 'Authorized only; merchant must capture',
  },
];

/** UPI handles: <behaviour>@ssb, any other valid VPA succeeds. */
export const UPI_HANDLES: Record<string, Behaviour> = {
  'success@ssb': 'success',
  'failure@ssb': 'fail',
  'pending@ssb': 'pending',
  'late@ssb': 'late',
};

/** Net banking: the login user id picks the outcome; anything else succeeds. */
export const NETBANKING_USERS: Record<string, Behaviour> = {
  fail: 'fail',
  pending: 'pending',
  late: 'late',
};

export function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\s+/g, '');
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function cardInfo(raw: string): {
  behaviour: Behaviour;
  network: string;
  type: string;
  last4: string;
} {
  const number = raw.replace(/\s+/g, '');
  const known = TEST_CARDS.find((c) => c.number === number);
  const network =
    known?.network ??
    (number.startsWith('5') ? 'Mastercard' : number.startsWith('6') ? 'RuPay' : 'Visa');
  return {
    behaviour: known?.behaviour ?? 'success',
    network,
    type: known?.type ?? 'debit',
    last4: number.slice(-4),
  };
}

/** MM/YY not in the past. */
export function expiryValid(raw: string, now = new Date()): boolean {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(raw.trim());
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  return (
    year > now.getUTCFullYear() || (year === now.getUTCFullYear() && month >= now.getUTCMonth() + 1)
  );
}
