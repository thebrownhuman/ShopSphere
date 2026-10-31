import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PAYMENT_CONFIG, type PaymentConfig } from '../payment/payment.config';

export interface FundAccount {
  name: string;
  accountNumber: string;
  ifsc: string;
}

export interface PayoutResult {
  bankPayoutId: string;
  status: 'processed' | 'rejected';
  utr: string | null;
  failureReason: string | null;
}

/** Thrown for transport/5xx failures: the payout may or may not exist; retry with the same key. */
export class PayoutUnavailableError extends Error {}

/**
 * ShopSphere Bank payout API (apps/bank-sim POST /v1/payouts, RazorpayX-like). Idempotent on
 * the key, so retrying a PROCESSING payout never pays twice.
 */
@Injectable()
export class BankPayoutClient {
  constructor(@Inject(PAYMENT_CONFIG) private readonly cfg: PaymentConfig) {}

  async payout(input: {
    amountPaise: number;
    reference: string;
    idempotencyKey: string;
    fundAccount: FundAccount;
  }): Promise<PayoutResult> {
    const auth = Buffer.from(`${this.cfg.BANK_KEY_ID}:${this.cfg.BANK_KEY_SECRET}`).toString(
      'base64',
    );
    let res: Response;
    try {
      res = await fetch(`${this.cfg.BANK_API_URL}/payouts`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify({
          amount: input.amountPaise,
          reference_id: input.reference,
          narration: 'ShopSphere settlement',
          fund_account: {
            name: input.fundAccount.name,
            account_number: input.fundAccount.accountNumber,
            ifsc: input.fundAccount.ifsc,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new PayoutUnavailableError(`bank unreachable: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status >= 500 || !body) throw new PayoutUnavailableError(`bank HTTP ${res.status}`);
    if (!res.ok) {
      const err = body.error as { description?: string } | undefined;
      return {
        bankPayoutId: '',
        status: 'rejected',
        utr: null,
        failureReason: err?.description ?? `bank HTTP ${res.status}`,
      };
    }
    return {
      bankPayoutId: String(body.id),
      status: body.status === 'processed' ? 'processed' : 'rejected',
      utr: (body.utr as string | null) ?? null,
      failureReason: (body.failure_reason as string | null) ?? null,
    };
  }
}

/**
 * Simulated beneficiary account until seller KYC (M5.1) stores verified bank details:
 * a stable 12-digit account number derived from the seller id at the simulated bank.
 */
export function simulatedFundAccount(sellerId: string, name: string): FundAccount {
  const digits = BigInt(`0x${createHash('sha256').update(sellerId).digest('hex').slice(0, 12)}`)
    .toString()
    .padStart(12, '1')
    .slice(-12);
  // Never end in 0000: bank-sim rejects those (reserved for failure testing).
  const accountNumber = digits.endsWith('0000') ? `${digits.slice(0, 11)}1` : digits;
  return { name: name.slice(0, 50), accountNumber, ifsc: 'SSBK0000001' };
}
