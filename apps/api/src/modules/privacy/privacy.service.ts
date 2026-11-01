import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { PrivacyDeletion, PrivacyExport, PrivacyOverview } from '@shopsphere/types';
import type Redis from 'ioredis';
import type { PrivacyRequest } from '@prisma/client';
import { ContactLookupService } from '../identity/account/contact-lookup.service';
import { SessionService } from '../identity/tokens/session.service';
import { LedgerService } from '../ledger/ledger.service';
import { NOTIFICATION_CHANNELS, type NotificationChannels } from '../notification/channels';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';
import { REDIS } from '../shared/redis/redis.module';
import { PrivacyExportStore } from './export.store';
import { zip } from './zip';

export const EXPORT_LINK_TTL_S = 15 * 60;
/** Archive kept (and downloadable through fresh signed links) for 7 days. */
export const EXPORT_RETENTION_MS = 7 * 24 * 3600 * 1000;
const EXPORT_COOLDOWN_MS = 24 * 3600 * 1000;
/** Orders in these states are finished; anything else blocks account deletion. */
const CLOSED_ORDER_STATUSES = [
  'DELIVERED',
  'CANCELLED',
  'CANCELLED_NO_STOCK',
  'PAYMENT_FAILED',
  'REFUNDED',
  'REPLACED',
];
export const DELETED_NAME = 'Deleted user';
const ANON_AUTHOR = 'ShopSphere customer';

export function graceDays(): number {
  const n = Number(process.env.PRIVACY_DELETION_GRACE_DAYS ?? 14);
  return Number.isFinite(n) && n >= 0 ? n : 14;
}

/** JSON with BigInt as strings (money in paise). */
const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

/**
 * DPDP Act 2023 data-principal rights (M7.3).
 *
 * Export: POST queues a PENDING request; the job (run right away in-process, and by the sweep as
 * a safety net) collects everything we hold about the shopper into a zip of JSON files in the
 * private bucket and emails a link to the account page, where a short-lived signed URL is minted.
 *
 * Deletion: needs a recent step-up re-auth; signs out every other device and is scheduled after a
 * grace period (cancellable by signing in). When due, the account is anonymised: identities,
 * addresses, wishlist/cart, push subscriptions, preferences and browsing history are deleted;
 * orders, invoices and ledger entries are kept for tax law (CGST Act s.36: 72 months) with the
 * address snapshot stripped to city/state/pincode; reviews and Q&A keep their text under an
 * anonymous name; every session is revoked.
 */
@Injectable()
export class PrivacyService {
  private readonly log = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly contacts: ContactLookupService,
    private readonly ledger: LedgerService,
    private readonly store: PrivacyExportStore,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannels,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async overview(userId: string): Promise<PrivacyOverview> {
    const [exp, del] = await Promise.all([
      this.latest(userId, 'EXPORT'),
      this.prisma.privacyRequest.findFirst({
        where: { userId, kind: 'DELETE', status: 'SCHEDULED' },
      }),
    ]);
    return {
      export: exp ? await this.toExport(exp, false) : null,
      deletion: del ? this.toDeletion(del) : null,
      graceDays: graceDays(),
    };
  }

  // ───────── Export ─────────

  async requestExport(userId: string, now = new Date()): Promise<PrivacyExport> {
    const last = await this.latest(userId, 'EXPORT');
    if (last?.status === 'PENDING') {
      throw new AppError('EXPORT_IN_PROGRESS', 'Your data export is being prepared', 409);
    }
    if (
      last &&
      now.getTime() - last.createdAt.getTime() < EXPORT_COOLDOWN_MS &&
      last.status === 'READY'
    ) {
      throw new AppError(
        'EXPORT_RATE_LIMITED',
        'You can request one export a day. Download the latest one instead.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const req = await this.prisma.privacyRequest.create({
      data: { userId, kind: 'EXPORT', status: 'PENDING' },
    });
    setImmediate(() => void this.runExport(req.id).catch(() => undefined));
    return this.toExport(req, false);
  }

  async latestExport(userId: string): Promise<PrivacyExport> {
    const req = await this.latest(userId, 'EXPORT');
    if (!req) throw new AppError('NO_EXPORT', 'No data export requested yet', 404);
    return this.toExport(req, true);
  }

  /** Builds the archive for a PENDING request. Safe to call twice (claims the row first). */
  async runExport(requestId: string, now = new Date()): Promise<boolean> {
    const claimed = await this.prisma.privacyRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (!claimed.count) return false;
    const req = await this.prisma.privacyRequest.findUniqueOrThrow({ where: { id: requestId } });
    try {
      const files = await this.collect(req.userId, now);
      const key = `privacy-exports/${req.userId}/${req.id}.zip`;
      await this.store.put(key, zip(files, now));
      await this.prisma.privacyRequest.update({
        where: { id: req.id },
        data: {
          status: 'READY',
          objectKey: key,
          completedAt: now,
          expiresAt: new Date(now.getTime() + EXPORT_RETENTION_MS),
        },
      });
      await this.notify(
        req.userId,
        'Your ShopSphere data export is ready',
        `Your data export is ready. Download it from Your Account → Privacy & data ` +
          `(${process.env.WEB_ORIGIN ?? 'http://localhost:3000'}/account/privacy) within 7 days.`,
      );
      return true;
    } catch (err) {
      this.log.warn(`export ${req.id} failed: ${(err as Error).message}`);
      await this.prisma.privacyRequest.update({
        where: { id: req.id },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 500) },
      });
      return false;
    }
  }

  /** Everything we hold about the shopper, one JSON file per area. */
  async collect(userId: string, now = new Date()) {
    const p = this.prisma;
    const user = await p.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        status: true,
        totpEnabled: true,
        createdAt: true,
        updatedAt: true,
        identities: { select: { type: true, value: true, verifiedAt: true, createdAt: true } },
      },
    });
    const [addresses, orders, returns, reviews, questions, answers, tickets, wishlist, carts] =
      await Promise.all([
        p.address.findMany({ where: { userId, deletedAt: null } }),
        p.order.findMany({
          where: { userId },
          include: { items: true, shipments: true, events: true },
          orderBy: { placedAt: 'desc' },
        }),
        p.returnRequest.findMany({ where: { userId } }),
        p.review.findMany({ where: { userId } }),
        p.question.findMany({ where: { userId } }),
        p.answer.findMany({ where: { userId } }),
        p.supportTicket.findMany({ where: { userId } }),
        p.wishlist.findUnique({ where: { userId }, include: { items: true } }),
        p.cart.findMany({ where: { userId }, include: { items: true, saved: true } }),
      ]);
    const [sessions, devices, recentlyViewed, storeBalance, prefs] = await Promise.all([
      p.session.findMany({
        where: { userId },
        select: {
          id: true,
          userAgent: true,
          ip: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      }),
      p.knownDevice.findMany({ where: { userId } }),
      p.recentlyViewed.findMany({ where: { ownerKey: `u:${userId}` } }),
      this.ledger.statement(userId),
      this.redis.hgetall(`notif:prefs:${userId}`),
    ]);
    const readme = [
      'ShopSphere data export (Digital Personal Data Protection Act, 2023)',
      `Generated: ${now.toISOString()}`,
      `Account: ${userId}`,
      '',
      'Money values are in paise (1/100 rupee). Passwords, 2FA secrets and payment card',
      'details are never stored by ShopSphere in readable form and are not included.',
      'Grievance officer: grievance@shopsphere.test (see /legal/grievance).',
    ].join('\n');
    return [
      { name: 'README.txt', data: readme },
      { name: 'profile.json', data: json({ ...user, notificationPreferences: prefs }) },
      { name: 'addresses.json', data: json(addresses) },
      { name: 'orders.json', data: json(orders) },
      { name: 'returns.json', data: json(returns) },
      { name: 'reviews.json', data: json(reviews) },
      { name: 'questions_answers.json', data: json({ questions, answers }) },
      { name: 'support_tickets.json', data: json(tickets) },
      { name: 'wishlist_cart.json', data: json({ wishlist, carts, recentlyViewed }) },
      { name: 'sessions.json', data: json({ sessions, devices }) },
      { name: 'store_balance.json', data: json(storeBalance) },
    ];
  }

  // ───────── Deletion ─────────

  async requestDeletion(
    userId: string,
    sessionId: string,
    now = new Date(),
  ): Promise<PrivacyDeletion> {
    await this.sessions.requireRecentReauth(sessionId);
    const existing = await this.prisma.privacyRequest.findFirst({
      where: { userId, kind: 'DELETE', status: 'SCHEDULED' },
    });
    if (existing)
      throw new AppError('DELETION_PENDING', 'Account deletion is already scheduled', 409);
    const seller = await this.prisma.sellerAccount.findUnique({ where: { userId } });
    if (seller) {
      throw new AppError(
        'SELLER_ACCOUNT',
        'Close your Seller Central account before deleting this account',
        409,
      );
    }
    const open = await this.prisma.order.count({
      where: { userId, status: { notIn: CLOSED_ORDER_STATUSES } },
    });
    if (open) {
      throw new AppError(
        'OPEN_ORDERS',
        'You have orders in progress. Delete your account once they are delivered or cancelled.',
        409,
        { openOrders: open },
      );
    }
    const req = await this.prisma.privacyRequest.create({
      data: {
        userId,
        kind: 'DELETE',
        status: 'SCHEDULED',
        scheduledFor: new Date(now.getTime() + graceDays() * 24 * 3600 * 1000),
      },
    });
    await this.sessions.revokeAll(userId, 'account_deletion_requested', sessionId);
    await this.notify(
      userId,
      'Your ShopSphere account is scheduled for deletion',
      `Your account will be deleted on ${req.scheduledFor!.toISOString().slice(0, 10)}. ` +
        'Sign in and cancel from Your Account → Privacy & data if this was not you.',
    );
    return this.toDeletion(req);
  }

  async cancelDeletion(userId: string): Promise<void> {
    const res = await this.prisma.privacyRequest.updateMany({
      where: { userId, kind: 'DELETE', status: 'SCHEDULED' },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    if (!res.count) throw new AppError('NOT_FOUND', 'No deletion scheduled', 404);
  }

  /** Anonymises the account of one due request. Exposed for the sweep and tests. */
  async executeDeletion(requestId: string, now = new Date()): Promise<boolean> {
    const req = await this.prisma.privacyRequest.findUnique({ where: { id: requestId } });
    if (!req || req.kind !== 'DELETE' || req.status !== 'SCHEDULED') return false;
    const userId = req.userId;
    const exportKeys = (
      await this.prisma.privacyRequest.findMany({
        where: { userId, kind: 'EXPORT', objectKey: { not: null } },
        select: { objectKey: true },
      })
    ).map((r) => r.objectKey!);
    const ownerKey = `u:${userId}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: null,
          passwordHash: null,
          totpSecret: null,
          totpEnabled: false,
          status: 'deleted',
          deletedAt: now,
        },
      });
      await tx.userIdentity.deleteMany({ where: { userId } });
      await tx.address.deleteMany({ where: { userId } });
      await tx.knownDevice.deleteMany({ where: { userId } });
      await tx.pushSubscription.deleteMany({ where: { userId } });
      await tx.wishlist.deleteMany({ where: { userId } });
      await tx.cart.deleteMany({ where: { userId } });
      await tx.checkoutSession.deleteMany({ where: { userId } });
      await tx.recentlyViewed.deleteMany({ where: { ownerKey } });
      await tx.searchEvent.updateMany({ where: { ownerKey }, data: { ownerKey: null } });
      await tx.supportTicket.updateMany({
        where: { userId },
        data: { subject: '[removed]', message: '[removed at the customer’s request]' },
      });
      await tx.review.updateMany({ where: { userId }, data: { authorName: ANON_AUTHOR } });
      await tx.question.updateMany({ where: { userId }, data: { authorName: ANON_AUTHOR } });
      await tx.answer.updateMany({ where: { userId }, data: { authorName: ANON_AUTHOR } });
      // Orders stay (GST records); strip the address snapshot to what the tax record needs.
      const orders = await tx.order.findMany({
        where: { userId },
        select: { id: true, address: true },
      });
      for (const o of orders) {
        const a = (o.address ?? {}) as Record<string, unknown>;
        await tx.order.update({
          where: { id: o.id },
          data: {
            address: {
              name: DELETED_NAME,
              phone: null,
              line1: null,
              line2: null,
              landmark: null,
              city: a.city ?? null,
              state: a.state ?? null,
              pincode: a.pincode ?? null,
              anonymisedAt: now.toISOString(),
            },
          },
        });
      }
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'account_deleted' },
      });
      await tx.privacyRequest.update({
        where: { id: req.id },
        data: { status: 'COMPLETED', completedAt: now },
      });
      await tx.privacyRequest.updateMany({
        where: { userId, kind: 'EXPORT', status: { in: ['READY', 'PENDING'] } },
        data: { status: 'EXPIRED', objectKey: null },
      });
    });
    await this.redis.del(`notif:prefs:${userId}`);
    for (const key of exportKeys) await this.store.remove(key);
    this.log.log(`account ${userId} anonymised (request ${req.id})`);
    return true;
  }

  /** Runs pending exports, due deletions and expires old archives. */
  async sweep(now = new Date()) {
    const pending = await this.prisma.privacyRequest.findMany({
      where: {
        kind: 'EXPORT',
        status: 'PENDING',
        createdAt: { lt: new Date(now.getTime() - 60_000) },
      },
      take: 20,
    });
    let exported = 0;
    for (const r of pending) if (await this.runExport(r.id, now)) exported++;
    const due = await this.prisma.privacyRequest.findMany({
      where: { kind: 'DELETE', status: 'SCHEDULED', scheduledFor: { lte: now } },
      take: 50,
    });
    let deleted = 0;
    for (const r of due) if (await this.executeDeletion(r.id, now)) deleted++;
    const stale = await this.prisma.privacyRequest.findMany({
      where: { kind: 'EXPORT', status: 'READY', expiresAt: { lte: now } },
      take: 100,
    });
    for (const r of stale) {
      if (r.objectKey) await this.store.remove(r.objectKey);
      await this.prisma.privacyRequest.update({
        where: { id: r.id },
        data: { status: 'EXPIRED', objectKey: null },
      });
    }
    return { exported, deleted, expired: stale.length };
  }

  // ───────── helpers ─────────

  private latest(userId: string, kind: 'EXPORT' | 'DELETE') {
    return this.prisma.privacyRequest.findFirst({
      where: { userId, kind },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async toExport(r: PrivacyRequest, withLink: boolean): Promise<PrivacyExport> {
    const ready = r.status === 'READY' && r.objectKey && r.expiresAt && r.expiresAt > new Date();
    return {
      id: r.id,
      status: r.status === 'PROCESSING' ? 'PENDING' : (r.status as PrivacyExport['status']),
      requestedAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      downloadUrl:
        withLink && ready
          ? await this.store.signedUrl(
              r.objectKey!,
              `shopsphere-data-${r.createdAt.toISOString().slice(0, 10)}.zip`,
              EXPORT_LINK_TTL_S,
            )
          : null,
    };
  }

  private toDeletion(r: PrivacyRequest): PrivacyDeletion {
    return {
      id: r.id,
      status: r.status as PrivacyDeletion['status'],
      requestedAt: r.createdAt.toISOString(),
      scheduledFor: r.scheduledFor!.toISOString(),
    };
  }

  private async notify(userId: string, subject: string, text: string) {
    try {
      const c = await this.contacts.contact(userId);
      if (c?.email) await this.channels.email(c.email, subject, text);
      else if (c?.phone) await this.channels.sms(c.phone, `${subject}. ${text}`);
    } catch (err) {
      this.log.warn(`privacy notice to ${userId} failed: ${(err as Error).message}`);
    }
  }
}
