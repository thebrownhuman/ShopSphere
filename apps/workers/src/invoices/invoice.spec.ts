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
    expect(text).toContain('incl. coupon / bank offer discount Rs. 200.00');
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

describe('invoice PDF from the full order.confirmed payload', () => {
  const address = {
    id: 'a1',
    name: 'Asha Rao',
    phone: '9876543210',
    line1: '12 MG Road',
    line2: null,
    landmark: null,
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
  };
  const full: OrderConfirmedPayload = {
    ...order,
    billingAddress: address,
    shippingAddress: address,
    shipments: [
      {
        ...order.shipments[0]!,
        sellerGstin: '29AAACS1234C1Z5',
        sellerAddress: 'Plot 4, Whitefield, Bengaluru, Karnataka - 560066',
        deliveryFeePaise: 4_000,
        invoiceNumber: 'INV-OD200001-1',
        invoiceKey: 'ord-1/shp-1.pdf',
        items: order.shipments[0]!.items.map((i) => ({ ...i, hsnCode: '8517' })),
      },
    ],
  };

  it('prints seller GSTIN + address, HSN, bill/ship-to and the delivery fee', () => {
    const text = renderInvoice(full, full.shipments[0]!, {
      number: 'INV-OD200001-1',
      issuedAt: full.occurredAt,
    }).toString('latin1');
    expect(text).toContain('GSTIN: 29AAACS1234C1Z5');
    expect(text).not.toContain('not on file');
    expect(text).toContain('Plot 4, Whitefield');
    expect(text).toContain('(8517)');
    expect(text).toContain('Bill to');
    expect(text).toContain('Ship to');
    expect(text).toContain('Asha Rao');
    expect(text).toContain('Delivery charges');
    // goods 16,999 + delivery 40
    expect(text).toContain('Rs. 17,039.00');
  });

  it('writes the PDF at the key the order module recorded', async () => {
    const sent: PutObjectCommand[] = [];
    const s3 = { send: async (c: unknown) => void sent.push(c as PutObjectCommand) };
    const out = await handleInvoiceEvent({ bucket: 'invoices', s3: s3 as never }, {
      id: 'e1',
      type: 'order.confirmed',
      occurredAt: full.occurredAt,
      payload: full,
    } as OrderEventEnvelope);
    expect(out[0]).toMatchObject({ number: 'INV-OD200001-1', storageKey: 'ord-1/shp-1.pdf' });
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
