import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Payment env, parsed apart from the shared schema so the module stays self-contained. */
export const paymentEnvSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    RAZORPAY_KEY_ID: z
      .string()
      .startsWith('rzp_test_', 'only Razorpay test-mode keys are allowed')
      .optional(),
    RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
    RAZORPAY_API_URL: z.string().url().default('https://api.razorpay.com/v1'),
    BANK_API_URL: z.string().url().default('http://localhost:4100/v1'),
    BANK_CHECKOUT_URL: z.string().url().default('http://localhost:4100/checkout'),
    BANK_KEY_ID: z.string().min(1).default('ssb_test_key_id'),
    BANK_KEY_SECRET: z.string().min(1).default('ssb_test_key_secret'),
    BANK_WEBHOOK_SECRET: z.string().min(1).default('ssb_test_webhook_secret'),
    /** Worker -> API internal calls (reconcile) and manual refunds until admin RBAC lands. */
    PAYMENT_INTERNAL_TOKEN: z.string().min(16).default('dev-internal-token-change-me'),
    PAYMENT_DEV_ROUTES: bool.optional(),
    /** M4.36 QA toggle (forced payment outcomes). Never honoured when NODE_ENV=production. */
    PAYMENT_TEST_TOGGLE: bool.optional(),
  })
  .transform((env) => ({
    ...env,
    devRoutes: env.PAYMENT_DEV_ROUTES ?? env.NODE_ENV !== 'production',
    testToggle: env.NODE_ENV !== 'production' && (env.PAYMENT_TEST_TOGGLE ?? true),
    razorpay:
      env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET
        ? {
            keyId: env.RAZORPAY_KEY_ID,
            keySecret: env.RAZORPAY_KEY_SECRET,
            webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
          }
        : null,
  }));

export type PaymentConfig = z.infer<typeof paymentEnvSchema>;
export const PAYMENT_CONFIG = Symbol('PAYMENT_CONFIG');

export function loadPaymentConfig(raw: Record<string, string | undefined>): PaymentConfig {
  const result = paymentEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid payment environment: ${issues}`);
  }
  if (result.data.NODE_ENV === 'production' && raw.PAYMENT_INTERNAL_TOKEN === undefined) {
    throw new Error(
      'Invalid payment environment: PAYMENT_INTERNAL_TOKEN must be set in production',
    );
  }
  return result.data;
}
