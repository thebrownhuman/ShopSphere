import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { OrderEventEnvelope } from '../orders/order-events';
import { invoiceKey, invoiceNumber, renderInvoice } from './invoice';

/**
 * Invoice consumer (M4.30): on `order.confirmed`, renders one GST invoice per shipment and stores
 * it in S3 (SeaweedFS locally) at `<bucket>/<orderId>/<shipmentId>.pdf`.
 *
 * Idempotent: redelivery overwrites the same objects. GAP (order module): there is no endpoint
 * to record the invoice on the shipment or to sign a download URL, so the web builds the link
 * from NEXT_PUBLIC_INVOICE_BASE_URL + the deterministic key (fine for the local simulation,
 * where the bucket is readable; production needs signed URLs from GET /orders/:id).
 */
export interface InvoiceJobOptions {
  bucket: string;
  s3: Pick<S3Client, 'send'>;
  now?: () => Date;
}

export function invoiceOptionsFromEnv(env: NodeJS.ProcessEnv): InvoiceJobOptions {
  return {
    bucket: env.INVOICE_BUCKET ?? 'invoices',
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

export interface GeneratedInvoice {
  shipmentId: string;
  number: string;
  storageKey: string;
  bytes: number;
}

const ready = new WeakMap<object, Promise<void>>();

/** Creates the bucket once per client if it does not exist. */
function ensureBucket(opts: InvoiceJobOptions): Promise<void> {
  let p = ready.get(opts.s3);
  if (!p) {
    p = opts.s3
      .send(new HeadBucketCommand({ Bucket: opts.bucket }))
      .then(() => undefined)
      .catch(() =>
        opts.s3.send(new CreateBucketCommand({ Bucket: opts.bucket })).then(() => undefined),
      )
      .catch((err: Error) => {
        ready.delete(opts.s3);
        throw err;
      });
    ready.set(opts.s3, p);
  }
  return p;
}

export async function handleInvoiceEvent(
  opts: InvoiceJobOptions,
  event: OrderEventEnvelope,
): Promise<GeneratedInvoice[]> {
  if (event.type !== 'order.confirmed') return [];
  const order = event.payload;
  await ensureBucket(opts);
  const issuedAt = (opts.now?.() ?? new Date()).toISOString();
  const out: GeneratedInvoice[] = [];
  for (const [i, shipment] of order.shipments.entries()) {
    const number = invoiceNumber(order, i);
    const body = renderInvoice(order, shipment, { number, issuedAt });
    const storageKey = invoiceKey(order.orderId, shipment.shipmentId);
    await opts.s3.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: storageKey,
        Body: body,
        ContentType: 'application/pdf',
        ContentDisposition: `attachment; filename="${number}.pdf"`,
      }),
    );
    out.push({ shipmentId: shipment.shipmentId, number, storageKey, bytes: body.length });
  }
  return out;
}
