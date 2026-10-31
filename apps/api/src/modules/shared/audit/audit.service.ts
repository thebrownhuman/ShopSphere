import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string;
  actorType: 'user' | 'seller' | 'admin' | 'system';
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  requestId?: string;
}

/** Append-only audit log. Pass `tx` to make the entry atomic with the change it records. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({ data: entry });
  }
}
