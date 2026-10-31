import type { PutObjectCommand } from '@aws-sdk/client-s3';
import type { OrderConfirmedPayload, OrderEventEnvelope } from '../orders/order-events';
import { invoiceLines, rupees, totals } from './gst';
import { invoiceKey, renderInvoice } from './invoice';
import { handleInvoiceEvent } from './invoice.job';

const KA = {
  name: 'Asha Verma',
  line1: '12 MG Road',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  stateCode: '29',
  pincode: '560038',
};
const MH = {
  ...KA,
  name: 'Gadget Hub Pvt Ltd',
  line1: 'Plot 7, MIDC',
  city: 'Pune',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '411019',
};

const order: OrderConfirmedPayload = {
  orderId: 'ord-1',
  orderNumber: 'OD200001',
  recipient: {
    userId: 'u1',
    name: 'Asha Verma',
    email: 'asha@example.test',
    phone: '+919876543210',
  },
  placedAt: '2026-10-31T10:00:00.000Z',
  paymentMethod: 'BANK',
  total: 1_839_800,
  billingAddress: KA,
  shippingAddress: KA,
  shipments: [
    {
      id: 'shp-1',
      seller: {
        id: 's1',
        legalName: 'ShopSphere Retail LLP',
        gstin: '29ABCDE1234F1Z5',
        address: { ...KA, name: 'ShopSphere Retail LLP' },
      },
      items: [
        {
          skuId: 'sku-1',
          title: 'Redmi Note 13 5G (128 GB)',
          qty: 1,
          unitPrice: 1_699_900,
          hsn: '8517',
          gstRate: 18,
        },
      ],
      shippingFee: 0,
      deliveryDate: '2026-11-04',
    },
    {
      id: 'shp-2',
      seller: { id: 's2', legalName: 'Gadget Hub Pvt Ltd', gstin: '27AAACG1234K1Z9', address: MH },
      items: [
        {
          skuId: 'sku-2',
          title: 'Milton Flask 1 L',
          qty: 2,
          unitPrice: 59_950,
          hsn: '9617',
          gstRate: 12,
        },
      ],
      shippingFee: 4_000,
      deliveryDate: '2026-11-05',
    },
  ],
};

describe('GST lines', () => {
  it('splits intra-state tax into CGST + SGST and backs out taxable value', () => {
    const [l] = invoiceLines(order.shipments[0]!, KA);
    expect(l!.taxable).toBe(Math.round((1_699_900 * 100) / 118));
    expect(l!.cgst + l!.sgst).toBe(1_699_900 - l!.taxable);
    expect(l!.igst).toBe(0);
  });

  it('charges IGST inter-state and taxes shipping as SAC 996812 @18%', () => {
    const lines = invoiceLines(order.shipments[1]!, KA);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.cgst === 0 && l.sgst === 0 && l.igst > 0)).toBe(true);
    expect(lines[1]).toMatchObject({ hsn: '996812', rate: 18, gross: 4_000 });
    const t = totals(lines);
    expect(t.taxable + t.igst).toBe(t.gross);
  });

  it('formats rupees Indian-style', () => {
    expect(rupees(1_699_900)).toBe('Rs. 16,999.00');
    expect(rupees(5)).toBe('Rs. 0.05');
  });
});

describe('invoice PDF', () => {
  it('is a well-formed PDF in the seller name with its GSTIN', () => {
    const pdf = renderInvoice(order, order.shipments[1]!, {
      number: 'INV-OD200001-2',
      issuedAt: '2026-10-31T10:05:00Z',
    });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('Sold by: Gadget Hub Pvt Ltd');
    expect(text).toContain('GSTIN: 27AAACG1234K1Z9');
    expect(text).toContain('IGST');
    expect(text).toContain('INV-OD200001-2');
    // xref offset points at the xref table
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
  });
});

describe('invoice job', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('uploads one PDF per shipment and registers each with the order module', async () => {
    const puts: PutObjectCommand['input'][] = [];
    const s3 = { send: jest.fn(async (cmd: PutObjectCommand) => void puts.push(cmd.input)) };
    const fetchMock = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const event: OrderEventEnvelope = {
      id: 'evt-1',
      type: 'order.confirmed',
      occurredAt: order.placedAt,
      payload: order,
    };

    const out = await handleInvoiceEvent(
      {
        apiUrl: 'http://api',
        internalToken: 't'.repeat(20),
        bucket: 'invoices',
        s3: s3 as never,
        now: () => new Date('2026-10-31T10:05:00Z'),
      },
      event,
    );

    expect(out.map((o) => o.storageKey)).toEqual([
      invoiceKey('ord-1', 'shp-1'),
      invoiceKey('ord-1', 'shp-2'),
    ]);
    expect(puts[0]).toMatchObject({
      Bucket: 'invoices',
      Key: 'invoices/ord-1/shp-1.pdf',
      ContentType: 'application/pdf',
    });
    expect((puts[0]!.Body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api/orders/internal/shipments/shp-2/invoice',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('ignores other event types', async () => {
    const s3 = { send: jest.fn() };
    const event = {
      id: 'e',
      type: 'order.shipped',
      occurredAt: '',
      payload: {},
    } as unknown as OrderEventEnvelope;
    await expect(
      handleInvoiceEvent({ apiUrl: '', internalToken: '', bucket: 'b', s3: s3 as never }, event),
    ).resolves.toEqual([]);
    expect(s3.send).not.toHaveBeenCalled();
  });

  it('fails (so the feed retries) when the order module rejects the registration', async () => {
    global.fetch = jest.fn(
      async () => new Response('{}', { status: 500 }),
    ) as unknown as typeof fetch;
    const event: OrderEventEnvelope = {
      id: 'evt-1',
      type: 'order.confirmed',
      occurredAt: '',
      payload: order,
    };
    await expect(
      handleInvoiceEvent(
        { apiUrl: 'http://api', internalToken: 'x', bucket: 'b', s3: { send: jest.fn() } as never },
        event,
      ),
    ).rejects.toThrow(/invoice register failed \(500\)/);
  });
});
