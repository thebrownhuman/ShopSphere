import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { BankError, BankPayment, BankService } from './bank.service';
import {
  Behaviour,
  cardInfo,
  expiryValid,
  luhnValid,
  NETBANKING_USERS,
  UPI_HANDLES,
} from './cards';
import { config } from './config';
import { checkoutPage, devPage, errorPage, otpPage } from './views';

interface CardSession {
  orderId: string;
  callbackUrl: string;
  behaviour: Behaviour;
  card: { last4: string; network: string; type: string };
  expiresAt: number;
}

type Form = Record<string, string | undefined>;

const SESSION_TTL_MS = 10 * 60 * 1000;

function callbackAllowed(url: string | undefined): url is string {
  try {
    return !!url && config.allowedCallbackOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/** Bank-hosted checkout. The only place card numbers, OTPs and bank passwords are ever entered. */
@Controller()
export class CheckoutController {
  private readonly sessions = new Map<string, CardSession>();

  constructor(private readonly bank: BankService) {}

  @Get('checkout')
  @Header('content-type', 'text/html; charset=utf-8')
  checkout(@Query() q: Form, @Res() res: Response) {
    if (q.key_id !== config.keyId) return res.status(401).send(errorPage('Unknown merchant key'));
    if (!callbackAllowed(q.callback_url))
      return res.status(400).send(errorPage('Callback URL not allowed'));
    const order = this.bank.orders.get(q.order_id ?? '');
    if (!order) return res.status(404).send(errorPage('Order not found'));
    if (order.status === 'paid')
      return this.redirectError(res, q.callback_url, order.id, null, 'Order already paid');
    return res.send(checkoutPage(order, q.callback_url));
  }

  @Post('checkout/pay')
  @HttpCode(200)
  pay(@Body() f: Form, @Res() res: Response) {
    if (!callbackAllowed(f.callback_url))
      return res.status(400).send(errorPage('Callback URL not allowed'));
    const order = this.bank.orders.get(f.order_id ?? '');
    if (!order) return res.status(404).send(errorPage('Order not found'));
    const again = (msg: string) => res.status(422).send(checkoutPage(order, f.callback_url!, msg));

    if (f.method === 'card') {
      if (!luhnValid(f.card_number ?? '')) return again('Card number is invalid');
      if (!expiryValid(f.expiry ?? '')) return again('Card has expired or expiry is invalid');
      if (!/^\d{3,4}$/.test(f.cvv ?? '')) return again('CVV is invalid');
      const { behaviour, ...card } = cardInfo(f.card_number!);
      const sessionId = randomBytes(16).toString('hex');
      this.sessions.set(sessionId, {
        orderId: order.id,
        callbackUrl: f.callback_url,
        behaviour,
        card,
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
      return res.send(otpPage(sessionId, order.amount, card.last4));
    }
    if (f.method === 'netbanking') {
      if (!f.user || !f.password) return again('Enter your customer ID and password');
      const behaviour = NETBANKING_USERS[f.user.toLowerCase()] ?? 'success';
      return this.complete(res, f.callback_url, order.id, behaviour, {
        method: 'netbanking',
        bank: f.bank ?? 'ShopSphere Bank',
        card: null,
        vpa: null,
      });
    }
    if (f.method === 'upi') {
      const vpa = (f.vpa ?? '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,64}@[a-z]{2,32}$/.test(vpa)) return again('UPI ID is invalid');
      return this.complete(res, f.callback_url, order.id, UPI_HANDLES[vpa] ?? 'success', {
        method: 'upi',
        vpa,
        card: null,
        bank: null,
      });
    }
    return again('Choose a payment method');
  }

  @Post('checkout/otp')
  @HttpCode(200)
  otp(@Body() f: Form, @Res() res: Response) {
    const session = this.sessions.get(f.session ?? '');
    if (!session || session.expiresAt < Date.now())
      return res.status(400).send(errorPage('Session expired'));
    this.sessions.delete(f.session!);
    const details = { method: 'card' as const, card: session.card, bank: null, vpa: null };
    if (f.otp !== config.otp) {
      return this.complete(
        res,
        session.callbackUrl,
        session.orderId,
        'fail',
        details,
        '3-D Secure authentication failed',
      );
    }
    return this.complete(res, session.callbackUrl, session.orderId, session.behaviour, details);
  }

  @Get('dev')
  @Header('content-type', 'text/html; charset=utf-8')
  dev() {
    return devPage(
      [...this.bank.orders.values()],
      [...this.bank.payments.values()].reverse(),
      this.bank.deliveries,
    );
  }

  @Post('dev/payments/:id/resolve')
  resolve(@Param('id') id: string, @Body() f: Form, @Res() res: Response) {
    this.bank.resolvePending(id, f.outcome === 'fail' ? 'fail' : 'capture');
    res.redirect(303, '/dev');
  }

  @Post('dev/webhooks/:eventId/replay')
  replay(@Param('eventId') eventId: string, @Res() res: Response) {
    this.bank.replay(eventId);
    res.redirect(303, '/dev');
  }

  private complete(
    res: Response,
    callbackUrl: string,
    orderId: string,
    behaviour: Behaviour,
    details: Pick<BankPayment, 'method' | 'card' | 'bank' | 'vpa'>,
    failReason?: string,
  ) {
    let payment: BankPayment;
    try {
      payment = this.bank.pay(orderId, details, behaviour, failReason);
    } catch (err) {
      if (err instanceof BankError)
        return this.redirectError(res, callbackUrl, orderId, null, err.message);
      throw err;
    }
    if (payment.status === 'failed') {
      return this.redirectError(
        res,
        callbackUrl,
        orderId,
        payment.id,
        payment.error_description ?? 'Payment failed',
      );
    }
    // Success, pending and authorized all come back signed; the merchant waits for the webhook.
    const url = new URL(callbackUrl);
    url.searchParams.set('payment_id', payment.id);
    url.searchParams.set('order_id', orderId);
    url.searchParams.set('signature', this.bank.sign(orderId, payment.id));
    res.redirect(303, url.toString());
  }

  private redirectError(
    res: Response,
    callbackUrl: string,
    orderId: string,
    paymentId: string | null,
    reason: string,
  ) {
    const url = new URL(callbackUrl);
    url.searchParams.set('order_id', orderId);
    if (paymentId) url.searchParams.set('payment_id', paymentId);
    url.searchParams.set('error_code', 'BAD_REQUEST_ERROR');
    url.searchParams.set('error_description', reason);
    res.redirect(303, url.toString());
  }
}
