import type { EventShipment, OrderConfirmedPayload, PostalAddress } from '../orders/order-events';
import { invoiceLines, rupees, totals } from './gst';
import { A4, PdfDoc } from './pdf';

/**
 * GST tax invoice for one shipment (M4.30). Marketplace model: the seller is the supplier, so
 * the invoice carries the seller's legal name, address and GSTIN; ShopSphere appears only as
 * the marketplace operator.
 */

export interface InvoiceMeta {
  /** Unique per seller per financial year in production; here derived from order + shipment. */
  number: string;
  /** ISO date of issue. */
  issuedAt: string;
}

export function invoiceNumber(order: OrderConfirmedPayload, shipmentIndex: number): string {
  return `INV-${order.orderNumber}-${shipmentIndex + 1}`;
}

export function invoiceKey(orderId: string, shipmentId: string): string {
  return `invoices/${orderId}/${shipmentId}.pdf`;
}

const addressLines = (a: PostalAddress) =>
  [a.line1, a.line2, `${a.city}, ${a.state} ${a.pincode}`].filter((l): l is string => !!l);

const COLS = { desc: 40, hsn: 250, qty: 300, rate: 335, taxable: 420, tax: 485, total: 555 };
const ROWS_PER_PAGE = 30;

export function renderInvoice(
  order: OrderConfirmedPayload,
  shipment: EventShipment,
  meta: InvoiceMeta,
): Buffer {
  const pdf = new PdfDoc();
  const { seller } = shipment;
  const intra = seller.address.stateCode === order.shippingAddress.stateCode;
  const lines = invoiceLines(shipment, order.shippingAddress);
  const sum = totals(lines);
  let y = A4.height - 50;

  pdf.text(40, y, 'TAX INVOICE', 16, true);
  pdf.textRight(555, y, 'Original for recipient', 8);
  y -= 24;
  pdf.text(40, y, `Sold by: ${seller.legalName}`, 10, true);
  pdf.text(330, y, `Invoice no: ${meta.number}`, 9, true);
  y -= 13;
  for (const l of addressLines(seller.address)) {
    pdf.text(40, y, l);
    y -= 12;
  }
  pdf.text(40, y, `GSTIN: ${seller.gstin}`, 9, true);
  const right = [
    `Invoice date: ${meta.issuedAt.slice(0, 10)}`,
    `Order no: ${order.orderNumber}`,
    `Order date: ${order.placedAt.slice(0, 10)}`,
    `Place of supply: ${order.shippingAddress.state} (${order.shippingAddress.stateCode})`,
  ];
  right.forEach((r, i) => pdf.text(330, A4.height - 87 - i * 12, r));
  y -= 24;

  pdf.text(40, y, 'Bill to', 9, true);
  pdf.text(330, y, 'Ship to', 9, true);
  y -= 12;
  const bill = [order.billingAddress.name, ...addressLines(order.billingAddress)];
  const ship = [order.shippingAddress.name, ...addressLines(order.shippingAddress)];
  for (let i = 0; i < Math.max(bill.length, ship.length); i++) {
    if (bill[i]) pdf.text(40, y, bill[i]!);
    if (ship[i]) pdf.text(330, y, ship[i]!);
    y -= 12;
  }
  y -= 12;

  const header = () => {
    pdf.rule(40, y + 12, 555, y + 12);
    pdf.text(COLS.desc, y, 'Description', 8, true);
    pdf.text(COLS.hsn, y, 'HSN/SAC', 8, true);
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
    pdf.text(
      COLS.desc,
      y,
      l.description.length > 40 ? `${l.description.slice(0, 37)}...` : l.description,
      8,
    );
    pdf.text(COLS.hsn, y, l.hsn, 8);
    pdf.text(COLS.qty, y, String(l.qty), 8);
    pdf.text(COLS.rate, y, `${l.rate}%`, 8);
    pdf.textRight(COLS.taxable, y, rupees(l.taxable), 8);
    pdf.textRight(COLS.tax, y, rupees(l.cgst + l.sgst + l.igst), 8);
    pdf.textRight(COLS.total, y, rupees(l.gross), 8);
    y -= 13;
  });
  pdf.rule(40, y + 6, 555, y + 6);
  y -= 8;
  const summary: Array<[string, number]> = [['Taxable value', sum.taxable]];
  if (intra) summary.push(['CGST', sum.cgst], ['SGST', sum.sgst]);
  else summary.push(['IGST', sum.igst]);
  summary.push(['Invoice total', sum.gross]);
  for (const [label, value] of summary) {
    const bold = label === 'Invoice total';
    pdf.text(380, y, label, 9, bold);
    pdf.textRight(COLS.total, y, rupees(value), 9, bold);
    y -= 13;
  }
  y -= 20;
  pdf.text(40, y, `For ${seller.legalName}`, 9, true);
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
