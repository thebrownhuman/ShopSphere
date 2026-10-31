import { z } from 'zod';
import { FREE_DELIVERY_MIN_PAISE } from '../delivery/delivery-estimate';

/** Cart env, parsed apart from the shared schema (same pattern as catalog.config). */
export const cartEnvSchema = z.object({
  /** PRD §7: max 50 distinct lines. */
  CART_MAX_LINES: z.coerce.number().int().positive().default(50),
  /** PRD §7: max 10 per item (offers may set a lower max_per_order). */
  CART_MAX_QTY_PER_ITEM: z.coerce.number().int().positive().default(10),
  CART_FREE_DELIVERY_MIN_PAISE: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(FREE_DELIVERY_MIN_PAISE),
  GUEST_CART_DAYS: z.coerce.number().int().positive().default(30),
  /** Signs the guest_cart cookie. Same secret identity uses for ss_session. */
  SESSION_COOKIE_SECRET: z.string().min(16).default('dev-only-session-cookie-secret-0123456789'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type CartConfig = z.infer<typeof cartEnvSchema>;
export const CART_CONFIG = Symbol('CART_CONFIG');

export function loadCartConfig(raw: Record<string, string | undefined>): CartConfig {
  const result = cartEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid cart environment: ${issues}`);
  }
  return result.data;
}
