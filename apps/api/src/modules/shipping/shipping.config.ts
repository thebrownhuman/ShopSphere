import { z } from 'zod';

/** Shipping env (M5.6), parsed apart from the shared schema like payment.config.ts. */
export const shippingEnvSchema = z.object({
  /** Active courier adapter. Only courier-sim exists today; Shiprocket/Delhivery plug in later. */
  COURIER_PROVIDER: z.enum(['courier-sim']).default('courier-sim'),
  COURIER_API_URL: z.string().url().default('http://localhost:4500/v1'),
  COURIER_API_KEY: z.string().min(1).default('cs_test_api_key'),
  COURIER_WEBHOOK_SECRET: z.string().min(1).default('cs_test_webhook_secret'),
  /** Default packed weight per unit when the seller does not enter one. */
  DEFAULT_UNIT_WEIGHT_GRAMS: z.coerce.number().int().positive().default(500),
});

export type ShippingConfig = z.infer<typeof shippingEnvSchema>;
export const SHIPPING_CONFIG = Symbol('SHIPPING_CONFIG');

export function loadShippingConfig(raw: Record<string, string | undefined>): ShippingConfig {
  const result = shippingEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid shipping environment: ${issues}`);
  }
  return result.data;
}
