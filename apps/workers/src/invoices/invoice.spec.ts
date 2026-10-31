import type { PutObjectCommand } from '@aws-sdk/client-s3';
import type { LineTax, OrderConfirmedPayload } from '@shopsphere/types';
import type { OrderEventEnvelope } from '../orders/order-events';
import { invoiceLines, rupees, totals } from './gst';
import { invoiceKey, renderInvoice } from './invoice';
import { handleInvoiceEvent } from './invoice.job';

const intra = (gross: number, rateBp: number): LineTax => {
  const taxable = Math.round((gross * 10_000) / (10_000 + rateBp));
  const half = Math.floor((gross - taxable) / 2);
  return {
    rateBp,
    taxablePaise: taxable,
    cgstPaise: half,
    sgstPaise: gross - taxable - half,
    igstPaise: 0,
  };
};
const inter = (gross: number, rateBp: number): LineTax => {
  const taxable = Math.round((gross * 10_000) / (10_000 + rateBp));
  return { rateBp, taxablePaise: taxable, cgstPaise: 0, sgstPaise: 0, igstPaise: gross - taxable };
};

const order: OrderConfirmedPayload = {
  orderId: 'ord-1',
  orderNumber: 'OD200001',
  userId: 'u1',
  status: 'CONFIRMED',
  occurredAt: '2026-10-31T10:00:00.000Z',
  paymentMethod: 'ONLINE',
  totalPaise: 1_819_800,
  payablePaise: 1_819_800,
  lateCapture: false,
  shipments: [
    {
      shipmentId: 'shp-1',
      sellerId: 's1',
      sellerName: 'ShopSphere Retail',
      sellerState: 'Karnataka',
      shipToState: 'Karnataka',
      promisedDate: '2026-11-04',
      items: [
        {
          orderItemId: 'i1',
          skuId: 'sku-1',
          title: 'Redmi Note 13 5G (128 GB)',
          qty: 1,
          unitPricePaise: 1_699_900,
          lineTotalPaise: 1_699_900,
          discountPaise: 0,
          tax: intra(1_699_900, 1800),
        },
      ],
    },
    {
      shipmentId: 'shp-2',
      sellerId: 's2',
      sellerName: 'Gadget Hub',
      sellerState: 'Maharashtra',
      shipToState: 'Karnataka',
      promisedDate: '2026-11-05',
      items: [
        {
          orderItemId: 'i2',
          skuId: 'sku-2',
          title: 'Milton Flask 1 L',
          qty: 2,
          unitPricePaise: 69_950,
          lineTotalPaise: 139_900,
          discountPaise: 20_000,
          tax: inter(119_900, 1200),
        },
      ],
    },
  ],
};

describe('invoice lines', () => {
  it('uses the order module tax split as-is (net of coupon)', () => {
    const [l] = invoiceLines(order.shipments[1]!);
    expect(l).toMatchObject({
      qty: 2,
      rate: 12,
      gross: 119_900,
      discount: 20_000,
      cgst: 0,
      sgst: 0,
    });
    const t = totals([l!]);
    expect(t.taxable + t.igst).toBe(t.gross);
  });

  it('formats rupees Indian-style', () => {
    expect(rupees(1_699_900)).toBe('Rs. 16,999.00');
    expect(rupees(5)).toBe('Rs. 0.05');
  });
});

describe('invoice PDF', () => {
  it('is a well-formed PDF issued in the seller name', () => {
    const pdf = renderInvoice(
      order,
      order.shipments[1]!,
      { number: 'INV-OD200001-2', issuedAt: '2026-10-31T10:05:00Z' },
      { sellerGstin: '27AAACG1234K1Z9' },
    );
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('Sold by: Gadget Hub');
    expect(text).toContain('GSTIN: 27AAACG1234K1Z9');
    expect(text).toContain('Place of supply: Karnataka');
    expect(text).toContain('IGST');
    expect(text).toContain('incl. coupon discount Rs. 200.00');
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('splits CGST + SGST for intra-state shipments', () => {
    const text = renderInvoice(order, order.shipments[0]!, {
      number: 'X',
      issuedAt: order.occurredAt,
    }).toString('latin1');
    expect(text).toContain('CGST+SGST');
    expect(text).toContain('GSTIN: not on file');
  });
});

describe('invoice job', () => {
  it('creates the bucket if needed and uploads one PDF per shipment', async () => {
    const puts: PutObjectCommand['input'][] = [];
    const names: string[] = [];
    const s3 = {
      send: jest.fn(async (cmd: { constructor: { name: string }; input: unknown }) => {
        names.push(cmd.constructor.name);
        if (cmd.constructor.name === 'HeadBucketCommand') throw new Error('NotFound');
        if (cmd.constructor.name === 'PutObjectCommand')
          puts.push(cmd.input as PutObjectCommand['input']);
      }),
    };
    const event: OrderEventEnvelope = {
      id: 'evt-1',
      type: 'order.confirmed',
      occurredAt: order.occurredAt,
      payload: order,
    };
    const out = await handleInvoiceEvent(
      { bucket: 'invoices', s3: s3 as never, now: () => new Date('2026-10-31T10:05:00Z') },
      event,
    );

    expect(names.slice(0, 2)).toEqual(['HeadBucketCommand', 'CreateBucketCommand']);
    expect(out.map((o) => o.storageKey)).toEqual([
      invoiceKey('ord-1', 'shp-1'),
      invoiceKey('ord-1', 'shp-2'),
    ]);
    expect(puts[0]).toMatchObject({
      Bucket: 'invoices',
      Key: 'ord-1/shp-1.pdf',
      ContentType: 'application/pdf',
    });
    expect((puts[0]!.Body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('ignores other event types', async () => {
    const s3 = { send: jest.fn() };
    const event = {
      id: 'e',
      type: 'order.cancelled',
      occurredAt: '',
      payload: {},
    } as unknown as OrderEventEnvelope;
    await expect(handleInvoiceEvent({ bucket: 'b', s3: s3 as never }, event)).resolves.toEqual([]);
    expect(s3.send).not.toHaveBeenCalled();
  });
});
