import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface UserContact {
  name: string | null;
  /** Verified email, if any. */
  email: string | null;
  /** Verified phone (E.164), if any. */
  phone: string | null;
}

/**
 * Read-only contact lookup exported by identity, so other modules (notifications) never read
 * identity tables directly. Only verified identities are returned.
 */
@Injectable()
export class ContactLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async contact(userId: string): Promise<UserContact | null> {
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
    if (!user) return null;
    return {
      name: user.name ?? null,
      email: user.identities.find((i) => i.type === 'email')?.value ?? null,
      phone: user.identities.find((i) => i.type === 'phone')?.value ?? null,
    };
  }
}
