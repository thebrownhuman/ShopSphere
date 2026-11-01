import type { OrderConfirmedPayload } from '@shopsphere/types';
import { invoiceLines, rupees, totals } from './gst';
import { A4, PdfDoc } from './pdf';

/**
 * GST tax invoice for one shipment (M4.30). Marketplace model: the seller is the supplier, so
 * the invoice is issued in the seller's name; ShopSphere appears only as marketplace operator.
 * Seller GSTIN + address, HSN per line, buyer address and the shipment's delivery fee come
 * from order.confirmed; `extras` can still override the GSTIN (older events lack it).
 */

type Shipment = OrderConfirmedPayload['shipments'][number];

export interface InvoiceMeta {
  number: string;
  /** ISO date of issue. */
  issuedAt: string;
}

export interface InvoiceExtras {
  sellerGstin?: string;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);

export function invoiceNumber(order: OrderConfirmedPayload, shipmentIndex: number): string {
  return `INV-${order.orderNumber}-${shipmentIndex + 1}`;
}

/** Object key inside the invoices bucket. */
export function invoiceKey(orderId: string, shipmentId: string): string {
  return `${orderId}/${shipmentId}.pdf`;
}

const COLS = { desc: 40, hsn: 240, qty: 290, rate: 320, taxable: 420, tax: 490, total: 555 };
const ROWS_PER_PAGE = 30;

export function renderInvoice(
  order: OrderConfirmedPayload,
  shipment: Shipment,
  meta: InvoiceMeta,
  extras: InvoiceExtras = {},
): Buffer {
  const pdf = new PdfDoc();
  const intra = shipment.sellerState === shipment.shipToState;
  const lines = invoiceLines(shipment);
  const sum = totals(lines);
  let y = A4.height - 50;

  pdf.text(40, y, 'TAX INVOICE', 16, true);
  pdf.textRight(555, y, 'Original for recipient', 8);
  y -= 24;
  pdf.text(40, y, `Sold by: ${shipment.sellerName}`, 10, true);
  pdf.text(330, y, `Invoice no: ${meta.number}`, 9, true);
  y -= 13;
  if (shipment.sellerAddress) {
    pdf.text(40, y, clip(shipment.sellerAddress, 60), 8);
    y -= 12;
  }
  pdf.text(40, y, `State: ${shipment.sellerState}`);
  y -= 12;
  const gstin = extras.sellerGstin ?? shipment.sellerGstin;
  pdf.text(40, y, `GSTIN: ${gstin ?? 'not on file (simulation)'}`, 9, true);
  [
    `Invoice date: ${meta.issuedAt.slice(0, 10)}`,
    `Order no: ${order.orderNumber}`,
    `Order date: ${order.occurredAt.slice(0, 10)}`,
    `Place of supply: ${shipment.shipToState}`,
  ].forEach((r, i) => pdf.text(330, A4.height - 87 - i * 12, r));
  y -= 24;
  const bill = order.billingAddress;
  const ship = order.shippingAddress ?? bill;
  if (bill || ship) {
    const block = (x: number, title: string, a: NonNullable<typeof bill>) => {
      pdf.text(x, y, title, 8, true);
      [
        a.name,
        clip([a.line1, a.line2].filter(Boolean).join(', '), 48),
        `${a.city}, ${a.state} - ${a.pincode}`,
        `Phone: ${a.phone}`,
      ].forEach((l, i) => pdf.text(x, y - 11 * (i + 1), l, 8));
    };
    if (bill) block(40, 'Bill to', bill);
    if (ship) block(330, 'Ship to', ship);
    y -= 66;
  }
  y -= 12;

  const header = () => {
    pdf.rule(40, y + 12, 555, y + 12);
    pdf.text(COLS.desc, y, 'Description', 8, true);
    pdf.text(COLS.hsn, y, 'HSN', 8, true);
    pdf.text(COLS.qty, y, 'Qty', 8, true);
    pdf.text(COLS.rate, y, 'GST %', 8, true);
    pdf.textRight(COLS.taxable, y, 'Taxable value', 8, true);
    pdf.textRight(COLS.tax, y, intra ? 'CGST+SGST' : 'IGST', 8, true);
    pdf.textRight(COLS.total, y, 'Total', 8, true);
    pdf.rule(40, y - 4, 555, y - 4);
    y -= 16;
  };
  header();
  lines.forEach((l, i) => {
    if (i > 0 && i % ROWS_PER_PAGE === 0) {
      pdf.addPage();
      y = A4.height - 50;
      header();
    }
    pdf.text(COLS.desc, y, clip(l.description, 38), 8);
    if (l.hsn) pdf.text(COLS.hsn, y, l.hsn, 8);
    pdf.text(COLS.qty, y, String(l.qty), 8);
    pdf.text(COLS.rate, y, `${l.rate}%`, 8);
    pdf.textRight(COLS.taxable, y, rupees(l.taxable), 8);
    pdf.textRight(COLS.tax, y, rupees(l.cgst + l.sgst + l.igst), 8);
    pdf.textRight(COLS.total, y, rupees(l.gross), 8);
    if (l.discount > 0) {
      y -= 10;
      pdf.text(COLS.desc + 8, y, `incl. coupon / bank offer discount ${rupees(l.discount)}`, 7);
    }
    y -= 13;
  });
  pdf.rule(40, y + 6, 555, y + 6);
  y -= 8;
  const summary: Array<[string, number]> = [['Taxable value', sum.taxable]];
  if (intra) summary.push(['CGST', sum.cgst], ['SGST', sum.sgst]);
  else summary.push(['IGST', sum.igst]);
  const fee = shipment.deliveryFeePaise ?? 0;
  if (fee > 0) summary.push(['Delivery charges', fee]);
  summary.push(['Invoice total', sum.gross + fee]);
  for (const [label, value] of summary) {
    const bold = label === 'Invoice total';
    pdf.text(380, y, label, 9, bold);
    pdf.textRight(COLS.total, y, rupees(value), 9, bold);
    y -= 13;
  }
  y -= 20;
  pdf.text(40, y, `For ${shipment.sellerName}`, 9, true);
  pdf.text(
    40,
    y - 12,
    'Authorised signatory (computer-generated invoice, no signature required)',
    8,
  );
  pdf.text(
    40,
    40,
    'Marketplace operator: ShopSphere (simulation). Goods are supplied by the seller named above.',
    7,
  );
  return pdf.toBuffer();
}
