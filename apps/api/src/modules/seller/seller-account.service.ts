import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type SellerAccount } from '@prisma/client';
import type {
  BankVerifyRequest,
  KycIssue,
  PickupAddress,
  SellerAccountView,
  SellerKycRequest,
  SellerStatus,
} from '@shopsphere/types';
import { AuditService } from '../shared/audit/audit.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';
import { isValidIfsc, normalizeId, validateTaxIds } from './kyc-validation';
import { namesMatch, PennyDropService } from './penny-drop';

const EDITABLE: SellerStatus[] = ['DRAFT', 'REJECTED'];

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Seller onboarding, KYC and the approval queue (M5.1). */
@Injectable()
export class SellerAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pennyDrop: PennyDropService,
    private readonly audit: AuditService,
  ) {}

  async me(userId: string): Promise<SellerAccountView> {
    return toView(await this.byUser(userId));
  }

  async register(userId: string, displayName: string): Promise<SellerAccountView> {
    const existing = await this.prisma.sellerAccount.findUnique({ where: { userId } });
    if (existing) throw new AppError('SELLER_EXISTS', 'You already have a seller account', 409);
    const row = await this.prisma.sellerAccount.create({ data: { userId, displayName } });
    await this.audit.record({
      actorId: userId,
      actorType: 'seller',
      action: 'seller.register',
      entityType: 'seller_account',
      entityId: row.id,
    });
    return toView(row);
  }

  async updateKyc(userId: string, req: SellerKycRequest): Promise<SellerAccountView> {
    const acc = await this.editable(userId);
    const pan = req.pan !== undefined ? normalizeId(req.pan) : acc.pan;
    const gstin = req.gstin !== undefined ? normalizeId(req.gstin) : acc.gstin;
    const pickup = req.pickup ?? (acc.pickup as PickupAddress | null);
    const issues = validateTaxIds({ pan, gstin, pickupState: pickup?.state });
    if (issues.length) throw kycInvalid(issues);
    const row = await this.prisma.sellerAccount.update({
      where: { id: acc.id },
      data: {
        legalName: req.legalName?.trim() ?? acc.legalName,
        pan,
        gstin,
        pickup: pickup ? (pickup as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    return toView(row);
  }

  /** Simulated penny drop; the name at the bank must match the legal name (or the holder name). */
  async verifyBank(userId: string, req: BankVerifyRequest): Promise<SellerAccountView> {
    const acc = await this.editable(userId);
    const ifsc = normalizeId(req.ifsc);
    const accountNumber = req.accountNumber.replace(/\s+/g, '');
    if (!isValidIfsc(ifsc)) throw kycInvalid([{ field: 'ifsc', message: 'Invalid IFSC code' }]);
    if (!/^\d{9,18}$/.test(accountNumber)) {
      throw kycInvalid([{ field: 'accountNumber', message: 'Account number must be 9-18 digits' }]);
    }
    const result = await this.pennyDrop.verify({ holderName: req.holderName, accountNumber, ifsc });
    if (!result.ok) {
      throw new AppError('BANK_VERIFY_FAILED', result.failureReason ?? 'Verification failed', 422, {
        reference: result.reference,
      });
    }
    const expected = acc.legalName ?? req.holderName;
    if (!result.nameAtBank || !namesMatch(result.nameAtBank, expected)) {
      throw new AppError(
        'BANK_VERIFY_FAILED',
        `Name at bank (${result.nameAtBank}) does not match ${expected}`,
        422,
        { reference: result.reference, nameAtBank: result.nameAtBank },
      );
    }
    const row = await this.prisma.sellerAccount.update({
      where: { id: acc.id },
      data: {
        bankHolderName: req.holderName.trim(),
        bankAccountLast4: accountNumber.slice(-4),
        bankAccountHash: createHash('sha256').update(`${ifsc}:${accountNumber}`).digest('hex'),
        bankIfsc: ifsc,
        bankNameAtBank: result.nameAtBank,
        bankVerifyRef: result.reference,
        bankVerifiedAt: new Date(),
      },
    });
    return toView(row);
  }

  async submit(userId: string): Promise<SellerAccountView> {
    const acc = await this.editable(userId);
    const missing = missingFields(acc);
    if (missing.length) {
      throw kycInvalid(missing.map((field) => ({ field, message: 'Required' })));
    }
    const issues = validateTaxIds({
      pan: acc.pan,
      gstin: acc.gstin,
      pickupState: (acc.pickup as PickupAddress | null)?.state,
    });
    if (issues.length) throw kycInvalid(issues);
    const row = await this.prisma.sellerAccount.update({
      where: { id: acc.id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), rejectionReason: null },
    });
    return toView(row);
  }

  // ───────── Admin approval queue ─────────

  async queue(status: SellerStatus): Promise<SellerAccountView[]> {
    const rows = await this.prisma.sellerAccount.findMany({
      where: { status },
      orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return rows.map(toView);
  }

  /** Approval creates the marketplace seller row that offers and orders reference. */
  async approve(id: string): Promise<SellerAccountView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const acc = await tx.sellerAccount.findUnique({ where: { id } });
      if (!acc) throw new AppError('SELLER_NOT_FOUND', 'Seller application not found', 404);
      if (acc.status !== 'SUBMITTED') {
        throw new AppError('KYC_LOCKED', `Application is ${acc.status}, not SUBMITTED`, 409);
      }
      const pickup = acc.pickup as unknown as PickupAddress;
      const seller =
        acc.sellerId ??
        (
          await tx.seller.create({
            data: {
              name: acc.displayName,
              slug: `${slugify(acc.displayName) || 'seller'}-${randomBytes(3).toString('hex')}`,
              pincode: pickup.pincode,
              city: pickup.city,
              state: pickup.state,
            },
          })
        ).id;
      const updated = await tx.sellerAccount.update({
        where: { id },
        data: { status: 'APPROVED', sellerId: seller, reviewedAt: new Date() },
      });
      // Fulfilment (orders/shipments/payouts) authorises sellers through seller_users.
      if (acc.userId) {
        await tx.sellerUser.upsert({
          where: { userId: acc.userId },
          update: { sellerId: seller },
          create: { userId: acc.userId, sellerId: seller, role: 'OWNER' },
        });
      }
      await this.audit.record(
        {
          actorType: 'admin',
          action: 'seller.approve',
          entityType: 'seller_account',
          entityId: id,
          after: { sellerId: seller },
        },
        tx,
      );
      return updated;
    });
    return toView(row);
  }

  async reject(id: string, reason: string): Promise<SellerAccountView> {
    const acc = await this.prisma.sellerAccount.findUnique({ where: { id } });
    if (!acc) throw new AppError('SELLER_NOT_FOUND', 'Seller application not found', 404);
    if (acc.status !== 'SUBMITTED') {
      throw new AppError('KYC_LOCKED', `Application is ${acc.status}, not SUBMITTED`, 409);
    }
    const row = await this.prisma.sellerAccount.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason, reviewedAt: new Date() },
    });
    await this.audit.record({
      actorType: 'admin',
      action: 'seller.reject',
      entityType: 'seller_account',
      entityId: id,
      after: { reason },
    });
    return toView(row);
  }

  /** Approved seller for listing/inventory routes. */
  async requireApproved(userId: string): Promise<SellerAccount & { sellerId: string }> {
    const acc = await this.byUser(userId);
    if (acc.status !== 'APPROVED' || !acc.sellerId) {
      throw new AppError('SELLER_NOT_APPROVED', 'Your seller account is not approved yet', 403);
    }
    return acc as SellerAccount & { sellerId: string };
  }

  private async byUser(userId: string): Promise<SellerAccount> {
    const acc = await this.prisma.sellerAccount.findUnique({ where: { userId } });
    if (!acc) throw new AppError('SELLER_NOT_FOUND', 'No seller account', HttpStatus.NOT_FOUND);
    return acc;
  }

  private async editable(userId: string): Promise<SellerAccount> {
    const acc = await this.byUser(userId);
    if (!EDITABLE.includes(acc.status as SellerStatus)) {
      throw new AppError('KYC_LOCKED', `KYC cannot change while ${acc.status}`, 409);
    }
    return acc;
  }
}

function kycInvalid(issues: KycIssue[]) {
  return new AppError('KYC_INVALID', issues.map((i) => i.message).join('; '), 422, issues);
}

function missingFields(a: SellerAccount): string[] {
  const out: string[] = [];
  if (!a.legalName) out.push('legalName');
  if (!a.pan) out.push('pan');
  if (!a.gstin) out.push('gstin');
  if (!a.bankVerifiedAt) out.push('bank');
  if (!a.pickup) out.push('pickup');
  return out;
}

export function toView(a: SellerAccount): SellerAccountView {
  return {
    id: a.id,
    status: a.status as SellerStatus,
    displayName: a.displayName,
    legalName: a.legalName,
    isFirstParty: a.isFirstParty,
    pan: a.pan,
    gstin: a.gstin,
    bank: a.bankAccountLast4
      ? {
          holderName: a.bankHolderName ?? '',
          accountLast4: a.bankAccountLast4,
          ifsc: a.bankIfsc ?? '',
          verified: !!a.bankVerifiedAt,
          nameAtBank: a.bankNameAtBank,
        }
      : null,
    pickup: (a.pickup as PickupAddress | null) ?? null,
    sellerId: a.sellerId,
    rejectionReason: a.rejectionReason,
    submittedAt: a.submittedAt?.toISOString() ?? null,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    missing: missingFields(a),
  };
}
