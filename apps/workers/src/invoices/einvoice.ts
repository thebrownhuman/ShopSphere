import { createHash, createHmac } from 'node:crypto';

/**
 * GST e-invoicing (M7.3) behind a provider interface. A real adapter calls the Invoice
 * Registration Portal (IRP / a GSP such as ClearTax) and returns the IRN, acknowledgement and the
 * IRP-signed QR payload; `SimulatedIrpProvider` derives the same shapes locally.
 *
 * IRN follows the portal's scheme: SHA-256 of `<supplier GSTIN><financial year><doc type><doc no>`,
 * so re-registering the same invoice yields the same IRN (redelivered events stay idempotent).
 */
export interface EInvoiceRequest {
  sellerGstin: string;
  /** Unregistered recipient (B2C) when absent. */
  buyerGstin?: string;
  docNumber: string;
  /** ISO date of issue. */
  docDate: string;
  totalPaise: number;
  itemCount: number;
  mainHsn?: string;
}

export interface EInvoiceResult {
  irn: string;
  ackNo: string;
  ackDate: string;
  /** Compact JWS (HS256 in the simulation, RS256 by the IRP in production). */
  signedQr: string;
}

export interface EInvoiceProvider {
  register(req: EInvoiceRequest): Promise<EInvoiceResult>;
}

/** Indian financial year of an ISO date, e.g. 2026-11-01 → "2026-27". */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.slice(0, 7).split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function irnFor(sellerGstin: string, docNumber: string, docDate: string): string {
  return createHash('sha256')
    .update(`${sellerGstin}${financialYear(docDate)}INV${docNumber}`)
    .digest('hex');
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

export class SimulatedIrpProvider implements EInvoiceProvider {
  constructor(private readonly secret: string) {}

  async register(req: EInvoiceRequest): Promise<EInvoiceResult> {
    const irn = irnFor(req.sellerGstin, req.docNumber, req.docDate);
    const ackNo = String(BigInt(`0x${irn.slice(0, 13)}`))
      .padStart(15, '0')
      .slice(0, 15);
    const ackDate = `${req.docDate.slice(0, 10)} 00:00:00`;
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'shopsphere-irp-sim' }));
    const data = {
      SellerGstin: req.sellerGstin,
      BuyerGstin: req.buyerGstin ?? 'URP',
      DocNo: req.docNumber,
      DocTyp: 'INV',
      DocDt: req.docDate.slice(0, 10),
      TotInvVal: req.totalPaise / 100,
      ItemCnt: req.itemCount,
      MainHsnCode: req.mainHsn ?? '',
      Irn: irn,
      IrnDt: ackDate,
    };
    const body = b64url(JSON.stringify({ data: JSON.stringify(data), iss: 'NIC-SIM' }));
    const sig = createHmac('sha256', this.secret).update(`${header}.${body}`).digest('base64url');
    return { irn, ackNo, ackDate, signedQr: `${header}.${body}.${sig}` };
  }
}

/** Verifies a simulated signed QR and returns its decoded payload (null when tampered). */
export function verifySimulatedQr(token: string, secret: string): Record<string, unknown> | null {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  const expected = createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
  if (expected !== s) return null;
  const outer = JSON.parse(Buffer.from(b, 'base64url').toString()) as { data: string };
  return JSON.parse(outer.data) as Record<string, unknown>;
}

export function einvoiceProviderFromEnv(env: NodeJS.ProcessEnv): EInvoiceProvider {
  return new SimulatedIrpProvider(env.EINVOICE_SIGNING_SECRET ?? 'shopsphere-irp-sim-secret');
}
