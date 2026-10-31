import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { renderImage, renditionKey } from './resize';

/**
 * Image pipeline (M2.3): originals uploaded to S3 (`product_images.status = PENDING`,
 * `storage_key` = original's key) are resized into WebP/AVIF renditions at
 * `products/<imageId>/<width>.<format>`, then the API marks the image READY with that prefix.
 */
export interface ImageJobOptions {
  apiUrl: string;
  internalToken: string;
  intervalMs: number;
  bucket: string;
  s3: S3Client;
}

export function imageOptionsFromEnv(env: NodeJS.ProcessEnv): ImageJobOptions {
  return {
    apiUrl: env.API_URL ?? 'http://localhost:4000',
    internalToken: env.CATALOG_INTERNAL_TOKEN ?? 'dev-internal-token-change-me',
    intervalMs: Number(env.IMAGE_JOB_INTERVAL_MS ?? 10_000),
    bucket: env.S3_BUCKET ?? 'catalog',
    s3: new S3Client({
      endpoint: env.S3_ENDPOINT ?? 'http://localhost:8333',
      region: env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY ?? 'any',
        secretAccessKey: env.S3_SECRET_KEY ?? 'any',
      },
    }),
  };
}

interface PendingImage {
  id: string;
  storageKey: string;
}

async function api(
  opts: ImageJobOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${opts.apiUrl}${path}`, {
    method,
    headers: { 'x-internal-token': opts.internalToken, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const parsed: unknown = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(`${method} ${path} failed (${res.status}): ${JSON.stringify(parsed)}`);
  return parsed;
}

export async function processImage(opts: ImageJobOptions, img: PendingImage): Promise<string> {
  const obj = await opts.s3.send(
    new GetObjectCommand({ Bucket: opts.bucket, Key: img.storageKey }),
  );
  const original = Buffer.from(await obj.Body!.transformToByteArray());
  const prefix = `products/${img.id}`;
  for (const r of await renderImage(original)) {
    await opts.s3.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: renditionKey(prefix, r),
        Body: r.body,
        ContentType: r.contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }
  return prefix;
}

export async function runImagesOnce(
  opts: ImageJobOptions,
): Promise<{ ready: number; failed: number }> {
  const { images } = (await api(opts, 'GET', '/catalog/internal/images/pending')) as {
    images: PendingImage[];
  };
  let ready = 0;
  let failed = 0;
  for (const img of images) {
    try {
      const storageKey = await processImage(opts, img);
      await api(opts, 'POST', `/catalog/internal/images/${img.id}/ready`, { storageKey });
      ready++;
    } catch (err) {
      failed++;
      console.log(
        JSON.stringify({
          level: 'warn',
          msg: 'image failed',
          job: 'images.resize',
          image: img.id,
          error: (err as Error).message,
        }),
      );
      await api(opts, 'POST', `/catalog/internal/images/${img.id}/failed`).catch(() => undefined);
    }
  }
  return { ready, failed };
}

export function startImageJob(opts: ImageJobOptions): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runImagesOnce(opts);
      if (r.ready || r.failed) {
        console.log(
          JSON.stringify({
            level: 'info',
            msg: 'image run',
            job: 'images.resize',
            time: new Date().toISOString(),
            ...r,
          }),
        );
      }
    } catch (err) {
      console.log(
        JSON.stringify({
          level: 'warn',
          msg: 'image run failed',
          job: 'images.resize',
          error: (err as Error).message,
        }),
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs);
  void tick();
  return () => clearInterval(timer);
}
