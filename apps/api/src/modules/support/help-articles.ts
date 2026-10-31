import type { HelpArticle } from '@shopsphere/types';

/** Help centre content (M6.8): static for v1; a CMS can replace this list later. */
export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'track-your-order',
    topic: 'Orders',
    title: 'Track your order',
    summary: 'Where to see delivery status and courier updates.',
    body: [
      'Open Your Orders and pick the order. The timeline shows every step from confirmation to delivery, updated as the courier scans the package.',
      'Delivery dates are estimates for your pincode. If an order is more than two days late, raise a ticket from the help centre and pick the order.',
    ],
  },
  {
    slug: 'cancel-an-order',
    topic: 'Orders',
    title: 'Cancel an order',
    summary: 'Orders can be cancelled until they ship.',
    body: [
      'Open the order in Your Orders and choose Cancel. Cancellation is available until the order is shipped.',
      'Prepaid orders are refunded to the original payment method in 5–7 working days. Store balance used on the order comes back instantly.',
    ],
  },
  {
    slug: 'return-policy',
    topic: 'Returns & refunds',
    title: 'Return policy and windows',
    summary: 'How long you have to return an item, by category.',
    body: [
      'Return windows start on the delivery date: electronics, mobiles and books 7 days; fashion, home and other categories 10 days.',
      'Grocery and beauty items are not returnable once delivered. An order containing a non-returnable item cannot be returned online; raise a support ticket instead.',
    ],
  },
  {
    slug: 'request-a-return',
    topic: 'Returns & refunds',
    title: 'Request a return',
    summary: 'Choose a reason, a pickup day and where your refund goes.',
    body: [
      'Open the delivered order in Your Orders and choose Return items. Pick a reason and one of the offered pickup days; the courier collects the package from your delivery address.',
      'When the package reaches the seller it is quality checked. Once it passes, the refund is issued straight away.',
    ],
  },
  {
    slug: 'refund-timelines',
    topic: 'Returns & refunds',
    title: 'Refund timelines',
    summary: 'Original payment method or instant ShopSphere Pay balance.',
    body: [
      'Refunds to the original payment method (UPI, cards, net banking) take 5–7 working days to reach your account after they are issued.',
      'Choose ShopSphere Pay balance for an instant refund you can spend on your next order. Cash on Delivery orders are refunded to ShopSphere Pay balance.',
    ],
  },
  {
    slug: 'payment-failed',
    topic: 'Payments',
    title: 'Payment failed but money was debited',
    summary: 'Automatic refunds for failed or duplicate payments.',
    body: [
      'If your bank debited you but the order shows payment failed, the amount is refunded automatically within 5–7 working days.',
      'If you paid twice for one order, the duplicate payment is refunded automatically as soon as it is detected.',
    ],
  },
  {
    slug: 'notifications',
    topic: 'Account',
    title: 'Order notifications: email, SMS, WhatsApp and browser',
    summary: 'Choose how you hear about your orders.',
    body: [
      'Go to Account, Notifications to turn email, SMS, WhatsApp and browser notifications on or off for order updates and payment alerts.',
      'Browser notifications need your permission in the browser; you can revoke it at any time from the site settings.',
    ],
  },
];
