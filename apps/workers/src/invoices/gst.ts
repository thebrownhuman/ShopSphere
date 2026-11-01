import type { OrderConfirmedPayload } from '@shopsphere/types';

/**
 * Invoice lines from the order module's per-line GST split (LineTax: taxable value after coupon,
 * CGST+SGST intra-state or IGST inter-state). The worker never recomputes tax, so the invoice
 * always matches what checkout charged.
 */

type Shipment = OrderConfirmedPayload['shipments'][number];

export interface InvoiceLine {
  description: string;
  hsn: string | null;
  qty: number;
  /** Percent, e.g. 18. */
  rate: number;
  /** Net of coupon discount, GST-inclusive. */
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface InvoiceTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  gross: number;
}

export function invoiceLines(shipment: Shipment): InvoiceLine[] {
  return shipment.items.map((i) => ({
    description: i.title,
    hsn: i.hsnCode ?? null,
    qty: i.qty,
    rate: i.tax.rateBp / 100,
    gross: i.lineTotalPaise - i.discountPaise,
    discount: i.discountPaise,
    taxable: i.tax.taxablePaise,
    cgst: i.tax.cgstPaise,
    sgst: i.tax.sgstPaise,
    igst: i.tax.igstPaise,
  }));
}

export function totals(lines: InvoiceLine[]): InvoiceTotals {
  return lines.reduce(
    (t, l) => ({
      taxable: t.taxable + l.taxable,
      cgst: t.cgst + l.cgst,
      sgst: t.sgst + l.sgst,
      igst: t.igst + l.igst,
      gross: t.gross + l.gross,
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0, gross: 0 },
  );
}

/** "Rs. 1,234.50": the PDF uses a standard font without the ₹ glyph. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100).toLocaleString('en-IN');
  return `${sign}Rs. ${whole}.${String(abs % 100).padStart(2, '0')}`;
}
