import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import type { Address as AddressRow } from '@prisma/client';
import type { Address, AddressInput, PincodeInfo, SessionInfo } from '@shopsphere/types';
import { AuditService } from '../../shared/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AuthService, hashPassword, verifyPassword } from '../auth/auth.service';
import { maskIdentifier, parseIdentifier, type Identifier } from '../identifiers';
import { OtpService } from '../otp/otp.service';
import { SessionService } from '../tokens/session.service';

const MAX_ADDRESSES = 20;

function toAddress(a: AddressRow): Address {
  return {
    id: a.id,
    name: a.name,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2,
    landmark: a.landmark,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    type: a.type as Address['type'],
    isDefault: a.isDefault,
  };
}

/** Profile, Login & Security, and Addresses for the signed-in user. */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async updateProfile(userId: string, name: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { name } });
    return this.auth.getAuthUser(userId);
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      current: s.id === currentSessionId,
      userAgent: s.userAgent,
      ip: s.ip,
      persistent: s.persistent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const res = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'user_revoked' },
    });
    if (res.count === 0) throw new AppError('NOT_FOUND', 'Session not found', 404);
  }

  /** Send a re-auth OTP to the user's primary verified contact (for OTP-only accounts). */
  async requestReauthOtp(userId: string) {
    const contact = await this.primaryContact(userId);
    return { ...(await this.otp.request(contact, 'reauth')), sentTo: maskIdentifier(contact) };
  }

  /** Step-up: password, OTP to primary contact, or TOTP. Marks the session as recently re-authenticated. */
  async reauth(
    userId: string,
    sessionId: string,
    proof: { password?: string; otp?: string; totp?: string },
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    let ok = false;
    if (proof.password && user.passwordHash)
      ok = await verifyPassword(user.passwordHash, proof.password);
    else if (proof.totp && user.totpEnabled && user.totpSecret)
      ok = authenticator.check(proof.totp, user.totpSecret);
    else if (proof.otp) {
      await this.otp.verify(await this.primaryContact(userId), 'reauth', proof.otp);
      ok = true;
    }
    if (!ok) throw new AppError('REAUTH_FAILED', 'Could not confirm it is you', 401);
    await this.sessions.markReauth(sessionId);
    return { ok: true };
  }

  /** Change/set password (step-up); signs out every other session. */
  async changePassword(userId: string, sessionId: string, newPassword: string) {
    await this.sessions.requireRecentReauth(sessionId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await this.sessions.revokeAll(userId, 'password_changed', sessionId);
    await this.audit.record({
      actorId: userId,
      actorType: 'user',
      action: 'user.password_changed',
      entityType: 'user',
      entityId: userId,
    });
    await this.auth.alertAll(
      user,
      'Your ShopSphere password was changed',
      'Your password was changed and other devices were signed out. If this was not you, reset your password now.',
    );
    return { ok: true };
  }

  async setupTotp(userId: string, sessionId: string) {
    await this.sessions.requireRecentReauth(sessionId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { identities: true },
    });
    if (user.totpEnabled) throw new AppError('TOTP_ALREADY_ENABLED', '2FA is already on', 409);
    const secret = authenticator.generateSecret();
    // Simulation: secret stored as-is. Production would envelope-encrypt it with a KMS key.
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
    const label =
      user.identities.find((i) => i.type === 'email' || i.type === 'phone')?.value ?? userId;
    return { secret, otpauthUrl: authenticator.keyuri(label, 'ShopSphere', secret) };
  }

  async enableTotp(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecret || !authenticator.check(code, user.totpSecret)) {
      throw new AppError('MFA_INVALID', 'Incorrect authenticator code', 400);
    }
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    await this.audit.record({
      actorId: userId,
      actorType: 'user',
      action: 'user.totp_enabled',
      entityType: 'user',
      entityId: userId,
    });
    return this.auth.getAuthUser(userId);
  }

  async disableTotp(userId: string, sessionId: string) {
    await this.sessions.requireRecentReauth(sessionId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null },
    });
    await this.audit.record({
      actorId: userId,
      actorType: 'user',
      action: 'user.totp_disabled',
      entityType: 'user',
      entityId: userId,
    });
    return this.auth.getAuthUser(userId);
  }

  /** M1.13 step 1: step-up, then OTP to the new value. */
  async requestIdentifierChange(userId: string, sessionId: string, raw: string) {
    await this.sessions.requireRecentReauth(sessionId);
    const id = parseIdentifier(raw);
    await this.assertAvailable(id, userId);
    return this.otp.request(id, 'change');
  }

  /** M1.13 step 2: verify OTP on the new value, notify the old value, then swap. */
  async confirmIdentifierChange(userId: string, sessionId: string, raw: string, code: string) {
    await this.sessions.requireRecentReauth(sessionId);
    const id = parseIdentifier(raw);
    await this.otp.verify(id, 'change', code);
    await this.assertAvailable(id, userId);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const old = await this.prisma.userIdentity.findFirst({ where: { userId, type: id.type } });
    if (old) {
      await this.auth.alertAll(
        user,
        `Your ShopSphere ${id.type} is being changed`,
        `Your sign-in ${id.type} is changing from ${maskIdentifier({ type: id.type, value: old.value })} to ${maskIdentifier(id)}. If this was not you, contact support immediately.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      if (old) await tx.userIdentity.delete({ where: { id: old.id } });
      await tx.userIdentity.create({
        data: { userId, type: id.type, value: id.value, verifiedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: userId,
          actorType: 'user',
          action: `user.${id.type}_changed`,
          entityType: 'user',
          entityId: userId,
          before: old ? { value: old.value } : undefined,
          after: { value: id.value },
        },
        tx,
      );
    });
    return this.auth.getAuthUser(userId);
  }

  // ───────── Addresses (M1.8) ─────────

  async listAddresses(userId: string): Promise<Address[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toAddress);
  }

  async createAddress(userId: string, input: AddressInput): Promise<Address> {
    const count = await this.prisma.address.count({ where: { userId, deletedAt: null } });
    if (count >= MAX_ADDRESSES)
      throw new AppError('ADDRESS_LIMIT', `You can save up to ${MAX_ADDRESSES} addresses`, 422);
    const makeDefault = input.isDefault === true || count === 0;
    const row = await this.prisma.$transaction(async (tx) => {
      if (makeDefault)
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.create({ data: { ...input, userId, isDefault: makeDefault } });
    });
    return toAddress(row);
  }

  async updateAddress(userId: string, id: string, input: Partial<AddressInput>): Promise<Address> {
    await this.ownAddress(userId, id);
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault)
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.update({
        where: { id },
        data: { ...input, isDefault: input.isDefault || undefined },
      });
    });
    return toAddress(row);
  }

  async setDefaultAddress(userId: string, id: string): Promise<Address> {
    return this.updateAddress(userId, id, { isDefault: true });
  }

  /** Soft delete; if it was the default, the oldest remaining address becomes default. */
  async deleteAddress(userId: string, id: string) {
    const existing = await this.ownAddress(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
      if (existing.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  async lookupPincode(pincode: string): Promise<PincodeInfo> {
    if (!/^[1-9]\d{5}$/.test(pincode))
      throw new AppError('INVALID_PINCODE', 'Enter a 6-digit pincode', 400);
    const row = await this.prisma.pincode.findUnique({ where: { pincode } });
    if (!row) throw new AppError('PINCODE_NOT_FOUND', 'We do not recognise this pincode yet', 404);
    return row;
  }

  private async ownAddress(userId: string, id: string) {
    const row = await this.prisma.address.findFirst({ where: { id, userId, deletedAt: null } });
    if (!row) throw new AppError('NOT_FOUND', 'Address not found', 404);
    return row;
  }

  private async assertAvailable(id: Identifier, userId: string) {
    const taken = await this.prisma.userIdentity.findUnique({
      where: { type_value: { type: id.type, value: id.value } },
    });
    if (taken && taken.userId !== userId)
      throw new AppError('IDENTIFIER_TAKEN', 'This is already linked to another account', 409);
    if (taken)
      throw new AppError('IDENTIFIER_UNCHANGED', 'This is already your sign-in ' + id.type, 409);
  }

  private async primaryContact(userId: string): Promise<Identifier> {
    const ids = await this.prisma.userIdentity.findMany({
      where: { userId, type: { in: ['phone', 'email'] }, verifiedAt: { not: null } },
    });
    const pick = ids.find((i) => i.type === 'phone') ?? ids[0];
    if (!pick) throw new AppError('NO_CONTACT', 'No verified email or phone on this account', 422);
    return { type: pick.type as Identifier['type'], value: pick.value };
  }
}
