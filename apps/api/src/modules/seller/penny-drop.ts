import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface PennyDropResult {
  ok: boolean;
  /** Account holder name as the bank has it (null when the account is invalid). */
  nameAtBank: string | null;
  reference: string;
  failureReason?: string;
}

/**
 * Bank account verification (M5.1). A real build sends ₹1 through the payout API and reads back
 * the beneficiary name; ShopSphere Bank sim has no payout API yet, so this stub answers
 * deterministically from the account number:
 *   ends in 0000 → account does not exist; ends in 9999 → name at bank differs; else success
 *   with the name as given.
 */
@Injectable()
export class PennyDropService {
  async verify(input: {
    holderName: string;
    accountNumber: string;
    ifsc: string;
  }): Promise<PennyDropResult> {
    const reference = `pd_${createHash('sha256')
      .update(`${input.ifsc}:${input.accountNumber}:${Date.now()}`)
      .digest('hex')
      .slice(0, 16)}`;
    if (input.accountNumber.endsWith('0000')) {
      return { ok: false, nameAtBank: null, reference, failureReason: 'Account does not exist' };
    }
    const nameAtBank = input.accountNumber.endsWith('9999')
      ? 'UNRELATED ACCOUNT HOLDER'
      : input.holderName.toUpperCase();
    return { ok: true, nameAtBank, reference };
  }
}

/** Loose name match: same words ignoring case, punctuation, titles and order. */
export function namesMatch(a: string, b: string): boolean {
  const words = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !['MR', 'MRS', 'MS', 'DR', 'M/S', 'MS'].includes(w))
      .sort()
      .join(' ');
  return words(a) === words(b);
}
