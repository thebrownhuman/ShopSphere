import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './app.module';
import { BankService } from './bank.service';
import { expiryValid, luhnValid, TEST_CARDS } from './cards';

const auth = `Basic ${Buffer.from('ssb_test_key_id:ssb_test_key_secret').toString('base64')}`;
const callback = 'http://localhost:3000/dev/pay/result';
const card = (n: string) => ({
  method: 'card',
  card_number: n,
  expiry: '12/30',
  cvv: '123',
  name: 'A',
});
const sessionOf = (html: string) => /name="session" value="([0-9a-f]+)"/.exec(html)![1];

describe('cards', () => {
  it('all magic test cards are Luhn-valid', () => {
    for (const c of TEST_CARDS) expect(luhnValid(c.number)).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('validates expiry', () => {
    const now = new Date('2026-10-31T00:00:00Z');
    expect(expiryValid('10/26', now)).toBe(true);
    expect(expiryValid('09/26', now)).toBe(false);
    expect(expiryValid('13/30', now)).toBe(false);
  });
});

describe('bank simulator (http)', () => {
  let app: INestApplication;
  let bank: BankService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    bank = app.get(BankService);
    bank.sendWebhooks = false;
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const createOrder = async (key: string) =>
    (
      await http()
        .post('/v1/orders')
        .set('authorization', auth)
        .set('idempotency-key', key)
        .send({ amount: 49900, currency: 'INR', receipt: 'ord1' })
        .expect(200)
    ).body as { id: string };
  const pay = (orderId: string, fields: Record<string, string>) =>
    http()
      .post('/checkout/pay')
      .type('form')
      .send({ order_id: orderId, callback_url: callback, ...fields });

  it('rejects bad merchant credentials', async () => {
    const res = await http().post('/v1/orders').send({ amount: 100 }).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('creates orders idempotently', async () => {
    const a = await createOrder('same');
    const b = await createOrder('same');
    expect(a.id).toBe(b.id);
  });

  it('card + OTP captures and redirects back with a valid signature', async () => {
    const order = await createOrder('card-1');
    const page = await pay(order.id, card('4111 1111 1111 1111')).expect(200);
    const res = await http()
      .post('/checkout/otp')
      .type('form')
      .send({ session: sessionOf(page.text), otp: '123456' })
      .expect(303);
    const url = new URL(res.headers.location);
    const paymentId = url.searchParams.get('payment_id')!;
    const expected = createHmac('sha256', 'ssb_test_key_secret')
      .update(`${order.id}|${paymentId}`)
      .digest('hex');
    expect(url.searchParams.get('signature')).toBe(expected);
    expect(bank.getPayment(paymentId).status).toBe('captured');
    expect(bank.deliveries[0].event).toBe('payment.captured');
  });

  it('wrong OTP fails the payment', async () => {
    const order = await createOrder('card-2');
    const page = await pay(order.id, card('5555555555554444')).expect(200);
    const res = await http()
      .post('/checkout/otp')
      .type('form')
      .send({ session: sessionOf(page.text), otp: '000000' })
      .expect(303);
    expect(new URL(res.headers.location).searchParams.get('error_description')).toMatch(
      /3-D Secure/,
    );
    expect(bank.deliveries[0].event).toBe('payment.failed');
  });

  it('rejects non-Luhn cards and foreign callback urls', async () => {
    const order = await createOrder('card-3');
    await pay(order.id, card('4111111111111112')).expect(422);
    await http()
      .get(
        `/checkout?order_id=${order.id}&key_id=ssb_test_key_id&callback_url=https://evil.example/x`,
      )
      .expect(400);
  });

  it('UPI pending stays pending until resolved; merchant fetch sees it', async () => {
    const order = await createOrder('upi-1');
    await pay(order.id, { method: 'upi', vpa: 'pending@ssb' }).expect(303);
    const list = await http()
      .get(`/v1/orders/${order.id}/payments`)
      .set('authorization', auth)
      .expect(200);
    expect(list.body.items[0].status).toBe('created');
    bank.resolvePending(list.body.items[0].id, 'capture');
    expect(bank.getPayment(list.body.items[0].id).status).toBe('captured');
  });

  it('authorize-only card needs merchant capture of the exact amount', async () => {
    const order = await createOrder('auth-1');
    const page = await pay(order.id, card('4000000000000044')).expect(200);
    await http()
      .post('/checkout/otp')
      .type('form')
      .send({ session: sessionOf(page.text), otp: '123456' });
    const paymentId = bank.paymentsForOrder(order.id)[0].id;
    expect(bank.getPayment(paymentId).status).toBe('authorized');
    const capture = (amount: number) =>
      http().post(`/v1/payments/${paymentId}/capture`).set('authorization', auth).send({ amount });
    await capture(100).expect(400);
    await capture(49900).expect(200);
    expect(bank.getPayment(paymentId).status).toBe('captured');
  });

  it('refunds are capped and idempotent', async () => {
    const order = await createOrder('nb-1');
    await pay(order.id, { method: 'netbanking', user: 'alice', password: 'x' }).expect(303);
    const paymentId = bank.paymentsForOrder(order.id)[0].id;
    const refund = (key: string, amount: number) =>
      http()
        .post(`/v1/payments/${paymentId}/refund`)
        .set('authorization', auth)
        .set('idempotency-key', key)
        .send({ amount });
    const r1 = await refund('r1', 40000).expect(200);
    const again = await refund('r1', 40000).expect(200);
    expect(again.body.id).toBe(r1.body.id);
    await refund('r2', 10000).expect(400);
  });

  it('payouts settle with a UTR, are idempotent and reject bad beneficiaries', async () => {
    const payout = (key: string, account: string) =>
      http()
        .post('/v1/payouts')
        .set('authorization', auth)
        .set('idempotency-key', key)
        .send({
          amount: 123_456,
          reference_id: 'batch-1',
          fund_account: { name: 'Seller', account_number: account, ifsc: 'SSBK0000001' },
        });
    const a = await payout('p1', '123456789012').expect(200);
    expect(a.body).toMatchObject({ status: 'processed', amount: 123_456 });
    expect(a.body.utr).toMatch(/^SSBN/);
    expect((await payout('p1', '123456789012').expect(200)).body.id).toBe(a.body.id);
    expect((await payout('p2', '123456780000').expect(200)).body.status).toBe('rejected');
    await payout('p3', 'abc').expect(400);
    await http().get(`/v1/payouts/${a.body.id}`).set('authorization', auth).expect(200);
  });
});
