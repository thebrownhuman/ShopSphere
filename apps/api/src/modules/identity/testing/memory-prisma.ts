import { randomUUID } from 'node:crypto';

interface SessionRow {
  id: string;
  userId: string;
  persistent: boolean;
  userAgent?: string;
  ip?: string;
  deviceId?: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  reauthAt: Date | null;
}

interface RefreshRow {
  id: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'not' in v) {
      return row[k] !== (v as { not: unknown }).not;
    }
    return row[k] === v;
  });
}

/** Just enough of Prisma's session + refresh_token delegates for SessionService tests. */
export class MemoryPrisma {
  sessions: SessionRow[] = [];
  tokens: RefreshRow[] = [];

  session = {
    create: async ({ data }: { data: Partial<SessionRow> }) => {
      const row: SessionRow = {
        id: randomUUID(),
        createdAt: new Date(),
        lastUsedAt: new Date(),
        revokedAt: null,
        revokedReason: null,
        reauthAt: null,
        persistent: false,
        ...data,
      } as SessionRow;
      this.sessions.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.sessions.find((s) => s.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
      const row = this.sessions.find((s) => s.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Where; data: Partial<SessionRow> }) => {
      const rows = this.sessions.filter((s) => matches(s as never, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
  };

  refreshToken = {
    create: async ({ data }: { data: Omit<RefreshRow, 'id' | 'usedAt'> }) => {
      const row: RefreshRow = { id: randomUUID(), usedAt: null, ...data };
      this.tokens.push(row);
      return row;
    },
    findUnique: async ({
      where,
      include,
    }: {
      where: { tokenHash: string };
      include?: { session: true };
    }) => {
      const row = this.tokens.find((t) => t.tokenHash === where.tokenHash);
      if (!row) return null;
      return include ? { ...row, session: this.sessions.find((s) => s.id === row.sessionId) } : row;
    },
    updateMany: async ({ where, data }: { where: Where; data: Partial<RefreshRow> }) => {
      const rows = this.tokens.filter((t) => matches(t as never, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
  };
}
