import { z } from 'zod';

/** Settlement env (M5.7). Rates in basis points; see settlement-math.ts for the formulas. */
export const settlementEnvSchema = z.object({
  SETTLEMENT_COMMISSION_BP: z.coerce.number().int().min(0).max(5_000).default(1_000),
  SETTLEMENT_TCS_BP: z.coerce.number().int().min(0).max(1_000).default(100),
  SETTLEMENT_TDS_BP: z.coerce.number().int().min(0).max(1_000).default(10),
  /** Days after delivery before a shipment is payable (return window). */
  SETTLEMENT_PAYOUT_DELAY_DAYS: z.coerce.number().int().min(0).max(60).default(7),
});

export type SettlementConfig = z.infer<typeof settlementEnvSchema>;
export const SETTLEMENT_CONFIG = Symbol('SETTLEMENT_CONFIG');

export function loadSettlementConfig(raw: Record<string, string | undefined>): SettlementConfig {
  const result = settlementEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid settlement environment: ${issues}`);
  }
  return result.data;
}
