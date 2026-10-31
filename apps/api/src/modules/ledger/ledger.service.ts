import { HttpStatus, Injectable } from '@nestjs/common';
import type { StoreBalanceResponse } from '@shopsphere/types';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';

/**
 * Closed-loop store balance (M4.7): gift cards and ShopSphere Pay balance can only be spent on
 * ShopSphere orders. There is deliberately no withdraw/transfer operation, which keeps this
 * outside RBI PPI licensing. Double entry: every posting group sums to zero; accounts carry a
 * cached balance updated in the same statement, and USER balances can't go negative (CHECK).
 *
 *   gift card redeemed   GIFT_CARD_FLOAT −x   user STORE_BALANCE +x
 *   paid on an order     user STORE_BALANCE −x   ORDER_CLEARING +x
 *   refunded / released  ORDER_CLEARING −x   user STORE_BALANCE +x
 */

const SYSTEM = 'shopsphere';
export type LedgerKind = 'GIFT_CARD_REDEEMED' | 'ORDER_PAYMENT' | 'ORDER_REFUND';

const isCheckViolation = (err: unknown) =>
  /ledger_accounts_user_balance_check|23514/.test(String((err as Error)?.message ?? err));

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private async account(
    tx: Tx,
    ownerType: 'USER' | 'SYSTEM',
    ownerId: string,
    kind: string,
  ): Promise<string> {
    await tx.$executeRaw`
      INSERT INTO ledger_accounts (owner_type, owner_id, kind) VALUES (${ownerType}, ${ownerId}, ${kind})
      ON CONFLICT (owner_type, owner_id, kind) DO NOTHING`;
    const row = await tx.ledgerAccount.findUniqueOrThrow({
      where: { ownerType_ownerId_kind: { ownerType, ownerId, kind } },
      select: { id: true },
    });
    return row.id;
  }

  private userAccount(tx: Tx, userId: string) {
    return this.account(tx, 'USER', userId, 'STORE_BALANCE');
  }

  /**
   * Posts a balanced group once per `key`. Returns false if the key was already posted.
   * Throws STORE_BALANCE_CHANGED if a user balance would go negative.
   */
  async post(
    tx: Tx,
    key: string,
    kind: LedgerKind,
    reference: string | null,
    entries: { accountId: string; amountPaise: bigint }[],
  ): Promise<boolean> {
    if (entries.reduce((s, e) => s + e.amountPaise, 0n) !== 0n) {
      throw new Error(`ledger posting ${key} is unbalanced`);
    }
    const { count } = await tx.ledgerTransaction.createMany({
      data: [{ key, kind, reference }],
      skipDuplicates: true,
    });
    if (count === 0) return false;
    const txn = await tx.ledgerTransaction.findUniqueOrThrow({
      where: { key },
      select: { id: true },
    });
    // Account rows are updated in id order so concurrent postings can't deadlock.
    for (const e of [...entries].sort((a, b) => a.accountId.localeCompare(b.accountId))) {
      try {
        await tx.$executeRaw`
          UPDATE ledger_accounts SET balance_paise = balance_paise + ${e.amountPaise}
          WHERE id = ${e.accountId}::uuid`;
      } catch (err) {
        if (isCheckViolation(err)) {
          throw new AppError(
            'STORE_BALANCE_CHANGED',
            'Your store balance changed. Please review your order.',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
    }
    await tx.ledgerEntry.createMany({
      data: entries.map((e) => ({
        transactionId: txn.id,
        accountId: e.accountId,
        amountPaise: e.amountPaise,
      })),
    });
    return true;
  }

  async balance(userId: string, db: Tx = this.prisma): Promise<bigint> {
    const row = await db.ledgerAccount.findUnique({
      where: {
        ownerType_ownerId_kind: { ownerType: 'USER', ownerId: userId, kind: 'STORE_BALANCE' },
      },
      select: { balancePaise: true },
    });
    return row?.balancePaise ?? 0n;
  }

  /** Spend store balance on an order (place-order, or re-applied on late capture). */
  async debitForOrder(
    tx: Tx,
    userId: string,
    orderId: string,
    amount: bigint,
    attempt = 0,
  ): Promise<void> {
    if (amount <= 0n) return;
    const [user, clearing] = [
      await this.userAccount(tx, userId),
      await this.account(tx, 'SYSTEM', SYSTEM, 'ORDER_CLEARING'),
    ];
    await this.post(tx, `order:${orderId}:debit:${attempt}`, 'ORDER_PAYMENT', orderId, [
      { accountId: user, amountPaise: -amount },
      { accountId: clearing, amountPaise: amount },
    ]);
  }

  /** Return store balance spent on an order (cancel, payment expiry, refund to balance). */
  async creditForOrder(
    tx: Tx,
    userId: string,
    orderId: string,
    amount: bigint,
    key: string,
  ): Promise<boolean> {
    if (amount <= 0n) return false;
    const [user, clearing] = [
      await this.userAccount(tx, userId),
      await this.account(tx, 'SYSTEM', SYSTEM, 'ORDER_CLEARING'),
    ];
    return this.post(tx, `order:${orderId}:${key}`, 'ORDER_REFUND', orderId, [
      { accountId: clearing, amountPaise: -amount },
      { accountId: user, amountPaise: amount },
    ]);
  }

  /** Locks the user's balance row (FOR UPDATE) and returns it. */
  async lockBalance(tx: Tx, userId: string): Promise<bigint> {
    const id = await this.userAccount(tx, userId);
    const rows = await tx.$queryRaw<{ balance_paise: bigint }[]>`
      SELECT balance_paise FROM ledger_accounts WHERE id = ${id}::uuid FOR UPDATE`;
    return rows[0]?.balance_paise ?? 0n;
  }

  /** Store-balance refunds recorded for an order. */
  async orderRefunds(orderId: string) {
    return this.prisma.ledgerTransaction.findMany({
      where: { reference: orderId, kind: 'ORDER_REFUND' },
      include: { entries: { include: { account: { select: { ownerType: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async statement(userId: string): Promise<StoreBalanceResponse> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: {
        ownerType_ownerId_kind: { ownerType: 'USER', ownerId: userId, kind: 'STORE_BALANCE' },
      },
      include: {
        entries: { orderBy: { createdAt: 'desc' }, take: 50, include: { transaction: true } },
      },
    });
    return {
      balancePaise: Number(account?.balancePaise ?? 0n),
      entries: (account?.entries ?? []).map((e) => ({
        id: e.id,
        amountPaise: Number(e.amountPaise),
        kind: e.transaction.kind,
        reference: e.transaction.reference,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  // ───────── Gift cards ─────────

  static hashCode(code: string): string {
    return createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex');
  }

  /** Issues a card and returns its code once (admin/QA tooling; the code is not stored). */
  async issueGiftCard(amountPaise: bigint, validDays = 365): Promise<{ id: string; code: string }> {
    const code = randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');
    const card = await this.prisma.giftCard.create({
      data: {
        codeHash: LedgerService.hashCode(code),
        last4: code.slice(-4),
        amountPaise,
        expiresAt: new Date(Date.now() + validDays * 86_400_000),
      },
    });
    return { id: card.id, code };
  }

  /** Redeems a gift card into the user's store balance. One-time; codes are not transferable after. */
  async redeemGiftCard(userId: string, code: string): Promise<StoreBalanceResponse> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; amount_paise: bigint }[]>`
        UPDATE gift_cards SET status = 'REDEEMED', redeemed_by = ${userId}::uuid, redeemed_at = now()
        WHERE code_hash = ${LedgerService.hashCode(code)} AND status = 'ACTIVE' AND expires_at > now()
        RETURNING id::text, amount_paise`;
      const card = rows[0];
      if (!card) {
        throw new AppError(
          'GIFT_CARD_INVALID',
          'This gift card is invalid, expired or already used',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const [float, user] = [
        await this.account(tx, 'SYSTEM', SYSTEM, 'GIFT_CARD_FLOAT'),
        await this.userAccount(tx, userId),
      ];
      await this.post(tx, `giftcard:${card.id}`, 'GIFT_CARD_REDEEMED', card.id, [
        { accountId: float, amountPaise: -card.amount_paise },
        { accountId: user, amountPaise: card.amount_paise },
      ]);
    });
    return this.statement(userId);
  }
}
