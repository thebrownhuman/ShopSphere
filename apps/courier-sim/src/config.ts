const env = process.env;

/** Courier simulator settings. Defaults match apps/api's COURIER_* defaults so local dev needs no setup. */
export const config = {
  port: Number(env.PORT ?? 4500),
  apiKey: env.COURIER_API_KEY ?? 'cs_test_api_key',
  webhookSecret: env.WEBHOOK_SECRET ?? 'cs_test_webhook_secret',
  webhookUrl: env.WEBHOOK_URL ?? 'http://localhost:4000/shipping/webhooks/courier-sim',
  /** Time between tracking steps (pickup → out for delivery → delivered). */
  stepMs: Number(env.STEP_MS ?? 30_000),
  /** false = shipments only move via POST /v1/shipments/:awb/advance. */
  autoAdvance: (env.AUTO_ADVANCE ?? 'true') !== 'false',
};
