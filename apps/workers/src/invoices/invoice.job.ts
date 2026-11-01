import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { OrderEventEnvelope } from '../orders/order-events';
import { einvoiceProviderFromEnv, type EInvoiceProvider } from './einvoice';
import { invoiceLines, totals } from './gst';
import { invoiceKey, invoiceNumber, renderInvoice } from './invoice';

/**
 * Invoice consumer (M4.30): on `order.confirmed`, renders one GST invoice per shipment and stores
 * it in S3 (SeaweedFS locally) at `<bucket>/<orderId>/<shipmentId>.pdf`.
 *
 * Idempotent: redelivery overwrites the same objects. The order module records the key and
 * number on the shipment at confirmation (payload `invoiceKey` / `invoiceNumber`) and serves the
 * PDF through a short-lived signed URL (GET /orders/:id/shipments/:shipmentId/invoice); the
 * bucket stays private.
 */
export interface InvoiceJobOptions {
  bucket: string;
  s3: Pick<S3Client, 'send'>;
  now?: () => Date;
  /** GST e-invoicing (IRN + signed QR). Skipped for shipments without a seller GSTIN. */
  einvoice?: EInvoiceProvider;
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
    einvoice: einvoiceProviderFromEnv(env),
  };
}

export interface GeneratedInvoice {
  shipmentId: string;
  number: string;
  storageKey: string;
  bytes: number;
  irn?: string;
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
    const number = shipment.invoiceNumber ?? invoiceNumber(order, i);
    const gstin = shipment.sellerGstin ?? undefined;
    const lines = invoiceLines(shipment);
    const einvoice =
      opts.einvoice && gstin
        ? await opts.einvoice.register({
            sellerGstin: gstin,
            docNumber: number,
            docDate: issuedAt,
            totalPaise: totals(lines).gross + (shipment.deliveryFeePaise ?? 0),
            itemCount: lines.length,
            mainHsn: lines.find((l) => l.hsn)?.hsn ?? undefined,
          })
        : undefined;
    const body = renderInvoice(order, shipment, { number, issuedAt, einvoice });
    const storageKey = shipment.invoiceKey ?? invoiceKey(order.orderId, shipment.shipmentId);
    await opts.s3.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: storageKey,
        Body: body,
        ContentType: 'application/pdf',
        ContentDisposition: `attachment; filename="${number}.pdf"`,
        Metadata: einvoice ? { irn: einvoice.irn, 'ack-no': einvoice.ackNo } : undefined,
      }),
    );
    out.push({
      shipmentId: shipment.shipmentId,
      number,
      storageKey,
      bytes: body.length,
      irn: einvoice?.irn,
    });
  }
  return out;
}
