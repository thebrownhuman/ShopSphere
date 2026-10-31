import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { StoreBalanceResponse } from '@shopsphere/types';
import { z } from 'zod';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { RateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { LedgerService } from './ledger.service';

const redeemSchema = z.object({ code: z.string().trim().min(8).max(40) });

/** ShopSphere Pay / gift-card balance (M4.7). Closed loop: no withdraw or transfer routes. */
@Controller('store-balance')
@UseGuards(AccessTokenGuard)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  get(@Auth() auth: AccessClaims): Promise<StoreBalanceResponse> {
    return this.ledger.statement(auth.sub);
  }

  @Post('gift-cards/redeem')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  redeem(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<StoreBalanceResponse> {
    return this.ledger.redeemGiftCard(auth.sub, redeemSchema.parse(body).code);
  }
}
