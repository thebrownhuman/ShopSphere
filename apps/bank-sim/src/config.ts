const env = process.env;

/** Bank simulator settings. Defaults match apps/api's BANK_* defaults so local dev needs no setup. */
export const config = {
  port: Number(env.PORT ?? 4100),
  keyId: env.MERCHANT_KEY_ID ?? 'ssb_test_key_id',
  keySecret: env.MERCHANT_KEY_SECRET ?? 'ssb_test_key_secret',
  webhookSecret: env.WEBHOOK_SECRET ?? 'ssb_test_webhook_secret',
  webhookUrl: env.WEBHOOK_URL ?? 'http://localhost:4000/payments/webhooks/bank',
  allowedCallbackOrigins: (env.ALLOWED_CALLBACK_ORIGINS ?? 'http://localhost:3000').split(','),
  lateCaptureDelayMs: Number(env.LATE_CAPTURE_DELAY_MS ?? 20_000),
  /** 3-D Secure OTP accepted by the simulator. */
  otp: '123456',
};
