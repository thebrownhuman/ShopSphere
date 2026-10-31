/**
 * Notification templates v1 (M4.31): order placed, payment failed, shipped, delivered, cancelled.
 *
 * The event shapes below are the subset of fields the templates read. The full payload contract
 * lives in apps/workers/src/orders/order-events.ts (reconciled with the order module's
 * packages/types/src/order.ts at merge).
 */

export type NotificationCategory = 'ORDER_UPDATES' | 'PAYMENT_ALERTS';

interface Recipient {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface Base {
  orderId: string;
  orderNumber: string;
  recipient: Recipient;
}

export type NotificationEvent =
  | {
      id: string;
      type: 'order.confirmed';
      payload: Base & {
        total: number;
        paymentMethod: string;
        shipments: { items: { title: string; qty: number }[]; deliveryDate: string | null }[];
      };
    }
  | {
      id: string;
      type: 'payment.failed';
      payload: Base & { amount: number; reason: string | null };
    }
  | {
      id: string;
      type: 'order.shipped';
      payload: Base & {
        itemTitles: string[];
        trackingId: string | null;
        carrier: string | null;
        deliveryDate: string | null;
      };
    }
  | {
      id: string;
      type: 'order.delivered';
      payload: Base & { itemTitles: string[] };
    }
  | {
      id: string;
      type: 'order.cancelled';
      payload: Base & { reason: string | null; refundAmount: number };
    };

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

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

const summarise = (titles: string[]) =>
  titles.length <= 1 ? (titles[0] ?? 'your items') : `${titles[0]} and ${titles.length - 1} more`;

const sign =
  'Thanks for shopping with ShopSphere.\n(This is a simulated store; no real goods or money are involved.)';

function clip(sms: string): string {
  return sms.length <= 160 ? sms : `${sms.slice(0, 157)}...`;
}

export function renderNotification(e: NotificationEvent, webUrl: string): RenderedNotification {
  const p = e.payload;
  const hi = `Hi ${firstName(p.recipient.name)},`;
  const orderUrl = `${webUrl}/orders/${encodeURIComponent(p.orderId)}`;

  switch (e.type) {
    case 'order.confirmed': {
      const items = e.payload.shipments.flatMap((s) => s.items);
      const latest = e.payload.shipments
        .map((s) => s.deliveryDate)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1);
      const by = day(latest ?? null);
      const cod = e.payload.paymentMethod === 'COD';
      return {
        category: 'ORDER_UPDATES',
        emailMandatory: true,
        email: {
          subject: `Your ShopSphere order ${p.orderNumber} is confirmed`,
          text: [
            hi,
            '',
            `We've received your order ${p.orderNumber}.`,
            '',
            ...items.map((i) => `  • ${i.title}${i.qty > 1 ? ` × ${i.qty}` : ''}`),
            '',
            `Order total: ${inr(e.payload.total)}${cod ? ' (pay on delivery)' : ' (paid)'}`,
            ...(by ? [`Arriving by ${by}.`] : []),
            `${e.payload.shipments.length > 1 ? `Ships in ${e.payload.shipments.length} packages. ` : ''}Invoices will be on the order page once ready.`,
            '',
            `Track your order: ${orderUrl}`,
            '',
            sign,
          ].join('\n'),
        },
        sms: clip(
          `ShopSphere: Order ${p.orderNumber} for ${inr(e.payload.total)} confirmed${by ? `, arriving by ${by}` : ''}. Track: ${orderUrl}`,
        ),
      };
    }
    case 'payment.failed': {
      const reason = e.payload.reason ? ` (${e.payload.reason})` : '';
      return {
        category: 'PAYMENT_ALERTS',
        emailMandatory: false,
        email: {
          subject: `Payment failed for order ${p.orderNumber}`,
          text: [
            hi,
            '',
            `Your payment of ${inr(e.payload.amount)} for order ${p.orderNumber} did not go through${reason}.`,
            'If any money was debited it will be refunded automatically.',
            '',
            `You can retry with another method within 15 minutes: ${orderUrl}`,
            '',
            sign,
          ].join('\n'),
        },
        sms: clip(
          `ShopSphere: Payment of ${inr(e.payload.amount)} for order ${p.orderNumber} failed. Retry within 15 min: ${orderUrl}`,
        ),
      };
    }
    case 'order.shipped': {
      const what = summarise(e.payload.itemTitles);
      const by = day(e.payload.deliveryDate);
      const tracking = e.payload.trackingId
        ? `${e.payload.carrier ? `${e.payload.carrier} ` : ''}tracking ID ${e.payload.trackingId}`
        : null;
      return {
        category: 'ORDER_UPDATES',
        emailMandatory: false,
        email: {
          subject: `Shipped: ${what}`,
          text: [
            hi,
            '',
            `${what} from order ${p.orderNumber} has shipped${by ? ` and should arrive by ${by}` : ''}.`,
            ...(tracking ? [`${tracking[0]!.toUpperCase()}${tracking.slice(1)}.`] : []),
            '',
            `Track your package: ${orderUrl}`,
            '',
            sign,
          ].join('\n'),
        },
        sms: clip(
          `ShopSphere: ${what} has shipped${by ? `, arriving by ${by}` : ''}. Track: ${orderUrl}`,
        ),
      };
    }
    case 'order.delivered': {
      const what = summarise(e.payload.itemTitles);
      return {
        category: 'ORDER_UPDATES',
        emailMandatory: false,
        email: {
          subject: `Delivered: ${what}`,
          text: [
            hi,
            '',
            `${what} from order ${p.orderNumber} has been delivered.`,
            'Not what you expected? You can request a return from the order page.',
            '',
            orderUrl,
            '',
            sign,
          ].join('\n'),
        },
        sms: clip(`ShopSphere: ${what} from order ${p.orderNumber} was delivered. ${orderUrl}`),
      };
    }
    case 'order.cancelled': {
      const refund =
        e.payload.refundAmount > 0
          ? `A refund of ${inr(e.payload.refundAmount)} is on its way to your original payment method (5–7 working days).`
          : 'Nothing was charged for this order.';
      return {
        category: 'ORDER_UPDATES',
        emailMandatory: false,
        email: {
          subject: `Order ${p.orderNumber} has been cancelled`,
          text: [
            hi,
            '',
            `Your order ${p.orderNumber} has been cancelled${e.payload.reason ? ` (${e.payload.reason})` : ''}.`,
            refund,
            '',
            orderUrl,
            '',
            sign,
          ].join('\n'),
        },
        sms: clip(
          `ShopSphere: Order ${p.orderNumber} cancelled.${e.payload.refundAmount > 0 ? ` Refund of ${inr(e.payload.refundAmount)} initiated.` : ''}`,
        ),
      };
    }
  }
}
