import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { SellerPayout as PayoutRow, SettlementLine as LineRow } from '@prisma/client';
import type {
  SellerPayout,
  SellerPayoutDetail,
  SellerPayoutsPage,
  SellerStatement,
  SettlementBreakdown,
  SettlementLine,
} from '@shopsphere/types';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import {
  BankPayoutClient,
  PayoutUnavailableError,
  simulatedFundAccount,
} from './bank-payout.client';
import { eligibleAt, planPayouts, settle } from './settlement-math';
import { SETTLEMENT_CONFIG, type SettlementConfig } from './settlement.config';

const n = (v: bigint | number) => Number(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PayoutRunSummary {
  batchId: string | null;
  payouts: number;
  paid: number;
  failed: number;
  pending: number;
  totalPaise: number;
}

/**
 * Settlement engine (M5.7). A settlement line is written in the same transaction that marks a
 * shipment DELIVERED; runPayouts() (daily, apps/workers) pays lines due T+7 in one batch, one
 * bank payout per seller.
 */
@Injectable()
export class SettlementService {
  private readonly log = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bank: BankPayoutClient,
    @Inject(SETTLEMENT_CONFIG) private readonly cfg: SettlementConfig,
  ) {}

  /** Idempotent per shipment. First-party (ShopSphere-owned) stock is not settled. */
  async recordDelivery(tx: Tx, shipmentId: string, deliveredAt: Date): Promise<void> {
    const s = await tx.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: { items: true, order: { select: { number: true } } },
    });
    const seller = await tx.seller.findUnique({ where: { id: s.sellerId } });
    if (!seller || seller.isFirstParty) return;
    const b = settle(
      {
        items: s.items.map((i) => ({
          taxablePaise: n(i.taxablePaise),
          cgstPaise: n(i.cgstPaise),
          sgstPaise: n(i.sgstPaise),
          igstPaise: n(i.igstPaise),
        })),
        courierCostPaise: n(s.shippingCostPaise ?? 0n),
        buyerDeliveryFeePaise: n(s.deliveryFeePaise),
      },
      {
        commissionBp: this.cfg.SETTLEMENT_COMMISSION_BP,
        feesGstBp: 1_800,
        tcsBp: this.cfg.SETTLEMENT_TCS_BP,
        tdsBp: this.cfg.SETTLEMENT_TDS_BP,
      },
    );
    await tx.settlementLine.createMany({
      data: [
        {
          shipmentId,
          orderId: s.orderId,
          orderNumber: s.order.number,
          sellerId: s.sellerId,
          grossPaise: BigInt(b.grossPaise),
          taxablePaise: BigInt(b.taxablePaise),
          commissionPaise: BigInt(b.commissionPaise),
          feesGstPaise: BigInt(b.feesGstPaise),
          shippingFeePaise: BigInt(b.shippingFeePaise),
          tcsPaise: BigInt(b.tcsPaise),
          tdsPaise: BigInt(b.tdsPaise),
          netPaise: BigInt(b.netPaise),
          deliveredAt,
          eligibleAt: eligibleAt(deliveredAt, this.cfg.SETTLEMENT_PAYOUT_DELAY_DAYS),
        },
      ],
      skipDuplicates: true,
    });
  }

  /** Daily payout run. Safe to re-run: retries PROCESSING payouts with the same idempotency key. */
  async runPayouts(now = new Date()): Promise<PayoutRunSummary> {
    const summary: PayoutRunSummary = {
      batchId: null,
      payouts: 0,
      paid: 0,
      failed: 0,
      pending: 0,
      totalPaise: 0,
    };
    const stuck = await this.prisma.sellerPayout.findMany({ where: { status: 'PROCESSING' } });

    const created = await this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<
        { id: string; seller_id: string; net_paise: bigint; eligible_at: Date }[]
      >`SELECT id::text, seller_id::text, net_paise, eligible_at FROM settlement_lines
        WHERE status = 'PENDING' AND eligible_at <= ${now}
        ORDER BY eligible_at FOR UPDATE SKIP LOCKED`;
      const plan = planPayouts(
        due.map((l) => ({
          id: l.id,
          sellerId: l.seller_id,
          netPaise: n(l.net_paise),
          eligibleAt: l.eligible_at,
        })),
        now,
      );
      if (plan.length === 0) return [];
      const batch = await tx.payoutBatch.create({
        data: {
          cutoffAt: now,
          payoutCount: plan.length,
          totalPaise: BigInt(plan.reduce((s, p) => s + p.amountPaise, 0)),
        },
      });
      summary.batchId = batch.id;
      const payouts: PayoutRow[] = [];
      for (const p of plan) {
        const payout = await tx.sellerPayout.create({
          data: {
            batchId: batch.id,
            sellerId: p.sellerId,
            amountPaise: BigInt(p.amountPaise),
            lineCount: p.lineIds.length,
          },
        });
        await tx.settlementLine.updateMany({
          where: { id: { in: p.lineIds }, status: 'PENDING' },
          data: { status: 'IN_PAYOUT', payoutId: payout.id },
        });
        payouts.push(payout);
      }
      return payouts;
    });

    for (const p of [...stuck, ...created]) {
      const outcome = await this.execute(p);
      summary.payouts += 1;
      summary[outcome] += 1;
      if (outcome === 'paid') summary.totalPaise += n(p.amountPaise);
    }
    if (summary.payouts > 0) this.log.log(`payout run: ${JSON.stringify(summary)}`);
    return summary;
  }

  private async execute(p: PayoutRow): Promise<'paid' | 'failed' | 'pending'> {
    const seller = await this.prisma.seller.findUnique({ where: { id: p.sellerId } });
    let result;
    try {
      result = await this.bank.payout({
        amountPaise: n(p.amountPaise),
        reference: p.id.slice(0, 40),
        idempotencyKey: `payout-${p.id}`,
        fundAccount: simulatedFundAccount(p.sellerId, seller?.name ?? 'Seller'),
      });
    } catch (err) {
      if (err instanceof PayoutUnavailableError) {
        this.log.warn(`payout ${p.id} pending: ${err.message}`);
        return 'pending';
      }
      throw err;
    }
    const paid = result.status === 'processed';
    await this.prisma.$transaction([
      this.prisma.sellerPayout.update({
        where: { id: p.id },
        data: paid
          ? {
              status: 'PAID',
              bankPayoutId: result.bankPayoutId,
              utr: result.utr,
              paidAt: new Date(),
            }
          : {
              status: 'FAILED',
              bankPayoutId: result.bankPayoutId || null,
              failureReason: result.failureReason,
            },
      }),
      // A rejected beneficiary needs ops/seller action: hold the lines rather than retry blindly.
      this.prisma.settlementLine.updateMany({
        where: { payoutId: p.id },
        data: { status: paid ? 'PAID' : 'ON_HOLD' },
      }),
    ]);
    return paid ? 'paid' : 'failed';
  }

  // ───────── Seller views ─────────

  async payouts(sellerId: string, cursor?: string, limit = 20): Promise<SellerPayoutsPage> {
    const rows = await this.prisma.sellerPayout.findMany({
      where: { sellerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor && UUID.test(cursor) ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(payoutView),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async payout(sellerId: string, payoutId: string): Promise<SellerPayoutDetail> {
    const p = UUID.test(payoutId)
      ? await this.prisma.sellerPayout.findFirst({
          where: { id: payoutId, sellerId },
          include: { lines: { orderBy: { deliveredAt: 'asc' } } },
        })
      : null;
    if (!p) throw new AppError('NOT_FOUND', 'Payout not found', HttpStatus.NOT_FOUND);
    return { ...payoutView(p), lines: p.lines.map(lineView) };
  }

  /** Statement of shipments delivered in [from, to] (IST calendar days, inclusive). */
  async statement(sellerId: string, from: string, to: string): Promise<SellerStatement> {
    const start = new Date(`${from}T00:00:00+05:30`);
    const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000);
    const lines = await this.prisma.settlementLine.findMany({
      where: { sellerId, deliveredAt: { gte: start, lt: end } },
      orderBy: { deliveredAt: 'asc' },
    });
    const views = lines.map(lineView);
    const keys: (keyof SettlementBreakdown)[] = [
      'grossPaise',
      'taxablePaise',
      'commissionPaise',
      'feesGstPaise',
      'shippingFeePaise',
      'tcsPaise',
      'tdsPaise',
      'netPaise',
    ];
    const totals = Object.fromEntries(
      keys.map((k) => [k, views.reduce((s, l) => s + l[k], 0)]),
    ) as unknown as SettlementBreakdown;
    const sum = (pred: (l: SettlementLine) => boolean) =>
      views.filter(pred).reduce((s, l) => s + l.netPaise, 0);
    return {
      from,
      to,
      lines: views,
      totals,
      paidOutPaise: sum((l) => l.status === 'PAID'),
      pendingPaise: sum((l) => l.status !== 'PAID'),
    };
  }
}

function payoutView(p: PayoutRow): SellerPayout {
  return {
    id: p.id,
    batchId: p.batchId,
    amountPaise: n(p.amountPaise),
    status: p.status as SellerPayout['status'],
    utr: p.utr,
    lineCount: p.lineCount,
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
  };
}

function lineView(l: LineRow): SettlementLine {
  return {
    id: l.id,
    shipmentId: l.shipmentId,
    orderNumber: l.orderNumber,
    status: l.status as SettlementLine['status'],
    grossPaise: n(l.grossPaise),
    taxablePaise: n(l.taxablePaise),
    commissionPaise: n(l.commissionPaise),
    feesGstPaise: n(l.feesGstPaise),
    shippingFeePaise: n(l.shippingFeePaise),
    tcsPaise: n(l.tcsPaise),
    tdsPaise: n(l.tdsPaise),
    netPaise: n(l.netPaise),
    deliveredAt: l.deliveredAt.toISOString(),
    eligibleAt: l.eligibleAt.toISOString(),
    payoutId: l.payoutId,
  };
}
