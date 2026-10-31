import type { OrderEventPayloads } from '@shopsphere/types';

/**
 * Notification templates v1 (M4.31) over the order module's outbox events
 * (OrderEventPayloads in packages/types/src/order.ts):
 *   order.confirmed                     -> "order placed"
 *   order.payment_failed                -> "payment failed, retry"
 *   order.payment_expired               -> "payment window closed"
 *   order.status_changed SHIPPED        -> "shipped"
 *   order.status_changed DELIVERED      -> "delivered"
 *   order.cancelled (incl. NO_STOCK)    -> "cancelled" / apology
 * The events carry ids only, so the service resolves the recipient and item titles first.
 */

export type NotificationCategory = 'ORDER_UPDATES' | 'PAYMENT_ALERTS';

export const NOTIFIED_TYPES = [
  'order.confirmed',
  'order.payment_failed',
  'order.payment_expired',
  'order.status_changed',
  'order.cancelled',
] as const;
export type NotifiedType = (typeof NOTIFIED_TYPES)[number];

export type NotificationEvent = {
  [T in NotifiedType]: { id: string; type: T; payload: OrderEventPayloads[T] };
}[NotifiedType];

export interface Recipient {
  name: string | null;
  email: string | null;
  /** E.164 */
  phone: string | null;
}

/** Order facts the events do not carry, looked up from the order module. */
export interface OrderContext {
  itemTitles: string[];
  /** Latest promised date, YYYY-MM-DD (IST). */
  deliveryDate: string | null;
}

export interface RenderedNotification {
  category: NotificationCategory;
  /** Sent even if the shopper turned email off for the category (order confirmation is a receipt). */
  emailMandatory: boolean;
  email: { subject: string; text: string };
  /** Kept under 160 characters (one SMS segment). */
  sms: string;
}

/** ₹1,23,456 (no paise when whole). */
export function inr(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function day(ymd: string | null): string | null {
  if (!ymd) return null;
  return new Date(`${ymd}T00:00:00+05:30`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || 'there';

const summarise = (titles: string[]) =>
  titles.length <= 1 ? (titles[0] ?? 'Your items') : `${titles[0]} and ${titles.length - 1} more`;

const sign =
  'Thanks for shopping with ShopSphere.\n(This is a simulated store; no real goods or money are involved.)';

const clip = (sms: string) => (sms.length <= 160 ? sms : `${sms.slice(0, 157)}...`);

/** Null when the event needs no message (e.g. PACKED). */
export function renderNotification(
  e: NotificationEvent,
  to: Recipient,
  ctx: OrderContext,
  webUrl: string,
): RenderedNotification | null {
  const p = e.payload;
  const hi = `Hi ${firstName(to.name)},`;
  const orderUrl = `${webUrl}/orders/${encodeURIComponent(p.orderId)}`;
  const what = summarise(ctx.itemTitles);
  const mail = (subject: string, lines: string[]) => ({
    subject,
    text: [hi, '', ...lines, '', sign].join('\n'),
  });

  switch (e.type) {
    case 'order.confirmed': {
      const by = day(
        e.payload.shipments
          .map((s) => s.promisedDate)
          .sort()
          .at(-1) ?? ctx.deliveryDate,
      );
      const items = e.payload.shipments.flatMap((s) => s.items);
      const cod = e.payload.paymentMethod === 'COD';
      const n = e.payload.shipments.length;
      return {
        category: 'ORDER_UPDATES',
        emailMandatory: true,
        email: mail(`Your ShopSphere order ${p.orderNumber} is confirmed`, [
          `We've received your order ${p.orderNumber}.`,
          '',
          ...items.map((i) => `  • ${i.title}${i.qty > 1 ? ` × ${i.qty}` : ''}`),
          '',
          `Order total: ${inr(e.payload.totalPaise)}${cod ? ` (pay ${inr(e.payload.payablePaise)} on delivery)` : ' (paid)'}`,
          ...(by ? [`Arriving by ${by}.`] : []),
          `${n > 1 ? `Ships in ${n} packages. ` : ''}GST invoices will be on the order page shortly.`,
          '',
          `Track your order: ${orderUrl}`,
        ]),
        sms: clip(
          `ShopSphere: Order ${p.orderNumber} for ${inr(e.payload.totalPaise)} confirmed${by ? `, arriving by ${by}` : ''}. Track: ${orderUrl}`,
        ),
      };
    }
    case 'order.payment_failed': {
      const reason = e.payload.reason ? ` (${e.payload.reason})` : '';
      return {
        category: 'PAYMENT_ALERTS',
        emailMandatory: false,
        email: mail(`Payment failed for order ${p.orderNumber}`, [
          `Your payment for order ${p.orderNumber} did not go through${reason}.`,
          'If any money was debited it will be refunded automatically.',
          '',
          `Your items are held for a few more minutes. Retry with another method: ${orderUrl}`,
        ]),
        sms: clip(
          `ShopSphere: Payment for order ${p.orderNumber} failed. Retry soon to keep your items: ${orderUrl}`,
        ),
      };
    }
    case 'order.payment_expired':
      return {
        category: 'PAYMENT_ALERTS',
        emailMandatory: false,
        email: mail(`Order ${p.orderNumber} was not paid`, [
          `We didn't receive payment of ${inr(e.payload.payablePaise)} for order ${p.orderNumber} in time, so the items went back on sale.`,
          'Your cart is unchanged. If money was debited, it is refunded automatically.',
          '',
          `${webUrl}/cart`,
        ]),
        sms: clip(
          `ShopSphere: Order ${p.orderNumber} was not paid in time and was released. Your cart is saved.`,
        ),
      };
    case 'order.status_changed': {
      if (p.status === 'SHIPPED') {
        const by = day(ctx.deliveryDate);
        return {
          category: 'ORDER_UPDATES',
          emailMandatory: false,
          email: mail(`Shipped: ${what}`, [
            `${what} from order ${p.orderNumber} has shipped${by ? ` and should arrive by ${by}` : ''}.`,
            '',
            `Track your package: ${orderUrl}`,
          ]),
          sms: clip(
            `ShopSphere: ${what} has shipped${by ? `, arriving by ${by}` : ''}. Track: ${orderUrl}`,
          ),
        };
      }
      if (p.status === 'DELIVERED') {
        return {
          category: 'ORDER_UPDATES',
          emailMandatory: false,
          email: mail(`Delivered: ${what}`, [
            `${what} from order ${p.orderNumber} has been delivered.`,
            'Not what you expected? You can request a return from the order page.',
            '',
            orderUrl,
          ]),
          sms: clip(`ShopSphere: ${what} from order ${p.orderNumber} was delivered. ${orderUrl}`),
        };
      }
      return null;
    }
    case 'order.cancelled': {
      const refund = e.payload.refunds.reduce((t, r) => t + r.amountPaise, 0);
      const toBalance = e.payload.refunds.some((r) => r.destination === 'STORE_BALANCE');
      const refundLine =
        refund > 0
          ? `A refund of ${inr(refund)} is on its way${toBalance ? ' (store balance refunds are instant)' : ' to your original payment method (5–7 working days)'}.`
          : 'Nothing was charged for this order.';
      const noStock = p.status === 'CANCELLED_NO_STOCK';
      return {
        category: 'ORDER_UPDATES',
        emailMandatory: noStock,
        email: noStock
          ? mail(`Sorry, we couldn't fulfil order ${p.orderNumber}`, [
              `Your payment for order ${p.orderNumber} arrived after the items had sold out, so we had to cancel it. We're sorry.`,
              refundLine,
              '',
              orderUrl,
            ])
          : mail(`Order ${p.orderNumber} has been cancelled`, [
              `Your order ${p.orderNumber} has been cancelled (${e.payload.reason}).`,
              refundLine,
              '',
              orderUrl,
            ]),
        sms: clip(
          `ShopSphere: Order ${p.orderNumber} cancelled${noStock ? ' (sold out, sorry)' : ''}.${refund > 0 ? ` Refund of ${inr(refund)} initiated.` : ''}`,
        ),
      };
    }
  }
}
