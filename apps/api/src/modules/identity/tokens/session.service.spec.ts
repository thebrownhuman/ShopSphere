import type { PrismaService } from '../../shared/prisma/prisma.service';
import { IdentityConfig } from '../identity.config';
import { MemoryPrisma } from '../testing/memory-prisma';
import { SessionService } from './session.service';

function setup() {
  const prisma = new MemoryPrisma();
  const config = { env: IdentityConfig.parse({}) } as IdentityConfig;
  const sessions = new SessionService(prisma as unknown as PrismaService, config);
  return { prisma, sessions };
}

const DAY = 24 * 60 * 60 * 1000;

describe('SessionService', () => {
  afterEach(() => jest.useRealTimers());

  describe('refresh token rotation', () => {
    it('issues a new refresh token on every refresh and keeps the session', async () => {
      const { sessions } = setup();
      const first = await sessions.create('u1', true, {});
      const second = await sessions.refresh(first.refreshToken);
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.sessionId).toBe(first.sessionId);
      const third = await sessions.refresh(second.refreshToken);
      await expect(sessions.authenticate(third.accessToken)).resolves.toEqual({
        sub: 'u1',
        sid: first.sessionId,
      });
    });

    it('reuse of a spent token revokes the whole family', async () => {
      const { sessions, prisma } = setup();
      const first = await sessions.create('u1', true, {});
      const second = await sessions.refresh(first.refreshToken);

      // Attacker replays the stolen, already-rotated token.
      await expect(sessions.refresh(first.refreshToken)).rejects.toMatchObject({
        code: 'REFRESH_TOKEN_REUSED',
        status: 401,
      });
      expect(prisma.sessions[0].revokedReason).toBe('refresh_token_reuse');

      // The legitimate holder's newer token and access token are dead too.
      await expect(sessions.refresh(second.refreshToken)).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
      await expect(sessions.authenticate(second.accessToken)).rejects.toMatchObject({
        code: 'SESSION_EXPIRED',
      });
    });

    it('only one of two concurrent refreshes with the same token wins', async () => {
      const { sessions } = setup();
      const first = await sessions.create('u1', false, {});
      const results = await Promise.allSettled([
        sessions.refresh(first.refreshToken),
        sessions.refresh(first.refreshToken),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('rejects unknown tokens', async () => {
      const { sessions } = setup();
      await expect(sessions.refresh('nope')).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('does not store refresh tokens in plaintext', async () => {
      const { sessions, prisma } = setup();
      const { refreshToken } = await sessions.create('u1', true, {});
      expect(prisma.tokens[0].tokenHash).not.toBe(refreshToken);
      expect(prisma.tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('session expiry', () => {
    it('"keep me signed in" sessions last 30 days', async () => {
      jest.useFakeTimers();
      const { sessions } = setup();
      const s = await sessions.create('u1', true, {});
      jest.advanceTimersByTime(29 * DAY);
      const next = await sessions.refresh(s.refreshToken);
      jest.advanceTimersByTime(1 * DAY + 1000);
      await expect(sessions.refresh(next.refreshToken)).rejects.toMatchObject({
        code: 'SESSION_EXPIRED',
      });
    });

    it('rotation does not extend the 30-day family lifetime', async () => {
      jest.useFakeTimers();
      const { sessions } = setup();
      const s = await sessions.create('u1', true, {});
      expect(s.sessionExpiresAt.getTime() - Date.now()).toBe(30 * DAY);
      jest.advanceTimersByTime(10 * DAY);
      const next = await sessions.refresh(s.refreshToken);
      expect(next.sessionExpiresAt.getTime()).toBe(s.sessionExpiresAt.getTime());
    });

    it('non-persistent sessions are capped at 12 hours', async () => {
      jest.useFakeTimers();
      const { sessions } = setup();
      const s = await sessions.create('u1', false, {});
      jest.advanceTimersByTime(12 * 60 * 60 * 1000 + 1000);
      await expect(sessions.refresh(s.refreshToken)).rejects.toMatchObject({
        code: 'SESSION_EXPIRED',
      });
    });

    it('access tokens expire after 15 minutes', async () => {
      jest.useFakeTimers();
      const { sessions } = setup();
      const s = await sessions.create('u1', true, {});
      await expect(sessions.authenticate(s.accessToken)).resolves.toBeDefined();
      jest.advanceTimersByTime(15 * 60 * 1000 + 1000);
      await expect(sessions.authenticate(s.accessToken)).rejects.toMatchObject({
        code: 'ACCESS_TOKEN_EXPIRED',
      });
    });

    it('logout-all kills live access tokens immediately', async () => {
      const { sessions } = setup();
      const a = await sessions.create('u1', true, {});
      const b = await sessions.create('u1', true, {});
      expect(await sessions.revokeAll('u1', 'logout_all')).toBe(2);
      await expect(sessions.authenticate(a.accessToken)).rejects.toMatchObject({
        code: 'SESSION_EXPIRED',
      });
      await expect(sessions.refresh(b.refreshToken)).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('step-up re-auth is valid for 10 minutes', async () => {
      jest.useFakeTimers();
      const { sessions } = setup();
      const s = await sessions.create('u1', true, {});
      await expect(sessions.requireRecentReauth(s.sessionId)).resolves.toBeUndefined();
      jest.advanceTimersByTime(10 * 60 * 1000 + 1000);
      await expect(sessions.requireRecentReauth(s.sessionId)).rejects.toMatchObject({
        code: 'REAUTH_REQUIRED',
      });
    });
  });
});
