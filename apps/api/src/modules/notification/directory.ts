import { Injectable } from '@nestjs/common';
import { OrderService } from '../order/order.service';
import { PrismaService } from '../shared/prisma/prisma.service';
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
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
  ) {}

  /**
   * GAP: identity has no contact-lookup service yet, so this reads its verified identities
   * directly (read-only). Swap for an identity service call when one is exported.
   */
  async recipient(userId: string): Promise<Recipient> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        identities: {
          where: { type: { in: ['email', 'phone'] }, verifiedAt: { not: null } },
          select: { type: true, value: true },
        },
      },
    });
    return {
      name: user?.name ?? null,
      email: user?.identities.find((i) => i.type === 'email')?.value ?? null,
      phone: user?.identities.find((i) => i.type === 'phone')?.value ?? null,
    };
  }

  async order(userId: string, orderId: string): Promise<OrderContext> {
    const o = await this.orders.detail(userId, orderId);
    return {
      itemTitles: o.shipments.flatMap((s) => s.items.map((i) => i.title)),
      deliveryDate:
        o.shipments
          .map((s) => s.promisedDate)
          .sort()
          .at(-1) ?? null,
    };
  }
}
