import { Injectable } from '@nestjs/common';
import { OrderService } from '../order/order.service';
import { ContactLookupService } from '../identity/account/contact-lookup.service';
import type { OrderContext, Recipient } from './templates';

export const NOTIFICATION_DIRECTORY = Symbol('NOTIFICATION_DIRECTORY');

/** Looks up what order events leave out: who to notify and what they bought. */
export interface NotificationDirectory {
  recipient(userId: string): Promise<Recipient>;
  order(userId: string, orderId: string): Promise<OrderContext>;
}

@Injectable()
export class PrismaNotificationDirectory implements NotificationDirectory {
  constructor(
    private readonly contacts: ContactLookupService,
    private readonly orders: OrderService,
  ) {}

  async recipient(userId: string): Promise<Recipient> {
    const c = await this.contacts.contact(userId);
    return { name: c?.name ?? null, email: c?.email ?? null, phone: c?.phone ?? null };
  }

  async order(userId: string, orderId: string): Promise<OrderContext> {
    const o = await this.orders.detail(userId, orderId);
    const tracked = o.shipments.find((s) => s.awb);
    return {
      itemTitles: o.shipments.flatMap((s) => s.items.map((i) => i.title)),
      courier: tracked?.courier ?? null,
      awb: tracked?.awb ?? null,
      deliveryDate:
        o.shipments
          .map((s) => s.promisedDate)
          .sort()
          .at(-1) ?? null,
    };
  }
}
