import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { OrderEventEnvelope } from '../orders/order-events';
import { invoiceKey, invoiceNumber, renderInvoice } from './invoice';

/**
 * Invoice consumer (M4.30): on `order.confirmed`, renders one GST invoice per shipment, stores it
 * in S3 (SeaweedFS locally) at a deterministic key and tells the order module, which stores the
 * key and hands out signed download links on GET /orders/:id.
 *
 * Idempotent: re-processing the same event overwrites the same objects and re-registers the same
 * keys. MERGE NOTE: `POST /orders/internal/shipments/:id/invoice` belongs to the order module.
 */
export interface InvoiceJobOptions {
  apiUrl: string;
  internalToken: string;
  bucket: string;
  s3: Pick<S3Client, 'send'>;
  now?: () => Date;
}

export function invoiceOptionsFromEnv(env: NodeJS.ProcessEnv): InvoiceJobOptions {
  return {
    apiUrl: env.API_URL ?? 'http://localhost:4000',
    internalToken: env.ORDER_INTERNAL_TOKEN ?? 'dev-internal-token-change-me',
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

export async function handleInvoiceEvent(
  opts: InvoiceJobOptions,
  event: OrderEventEnvelope,
): Promise<GeneratedInvoice[]> {
  if (event.type !== 'order.confirmed') return [];
  const order = (event as OrderEventEnvelope<'order.confirmed'>).payload;
  const issuedAt = (opts.now?.() ?? new Date()).toISOString();
  const out: GeneratedInvoice[] = [];
  for (const [i, shipment] of order.shipments.entries()) {
    const number = invoiceNumber(order, i);
    const body = renderInvoice(order, shipment, { number, issuedAt });
    const storageKey = invoiceKey(order.orderId, shipment.id);
    await opts.s3.send(
      new PutObjectCommand({
        Bucket: opts.bucket,
        Key: storageKey,
        Body: body,
        ContentType: 'application/pdf',
        ContentDisposition: `attachment; filename="${number}.pdf"`,
      }),
    );
    const res = await fetch(
      `${opts.apiUrl}/orders/internal/shipments/${encodeURIComponent(shipment.id)}/invoice`,
      {
        method: 'POST',
        headers: { 'x-internal-token': opts.internalToken, 'content-type': 'application/json' },
        body: JSON.stringify({ storageKey, number, bucket: opts.bucket }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) throw new Error(`invoice register failed (${res.status}) for ${shipment.id}`);
    out.push({ shipmentId: shipment.id, number, storageKey, bytes: body.length });
  }
  return out;
}
