import type { EventShipment, PostalAddress } from '../orders/order-events';

/**
 * GST maths for a tax invoice. Selling prices are GST-inclusive, so the taxable value is backed
 * out per line: taxable = round(gross * 100 / (100 + rate)). Intra-state supply splits the tax
 * into CGST + SGST (half each); inter-state supply charges IGST.
 */

export interface InvoiceLine {
  description: string;
  hsn: string;
  qty: number;
  rate: number;
  gross: number;
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

/** Shipping is a service (SAC 996812) taxed at 18 %. */
export const SHIPPING_SAC = '996812';
const SHIPPING_RATE = 18;

function line(
  description: string,
  hsn: string,
  qty: number,
  rate: number,
  gross: number,
  intraState: boolean,
): InvoiceLine {
  const taxable = Math.round((gross * 100) / (100 + rate));
  const tax = gross - taxable;
  const cgst = intraState ? Math.floor(tax / 2) : 0;
  const sgst = intraState ? tax - cgst : 0;
  return { description, hsn, qty, rate, gross, taxable, cgst, sgst, igst: intraState ? 0 : tax };
}

export function invoiceLines(shipment: EventShipment, shipTo: PostalAddress): InvoiceLine[] {
  const intra = shipment.seller.address.stateCode === shipTo.stateCode;
  const lines = shipment.items.map((i) =>
    line(i.title, i.hsn, i.qty, i.gstRate, i.unitPrice * i.qty, intra),
  );
  if (shipment.shippingFee > 0)
    lines.push(
      line('Shipping charges', SHIPPING_SAC, 1, SHIPPING_RATE, shipment.shippingFee, intra),
    );
  return lines;
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
