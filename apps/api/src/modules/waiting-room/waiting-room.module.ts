import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { WaitingRoomStatus } from '@shopsphere/types';
import { z } from 'zod';
import { IdentityModule } from '../identity/identity.module';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { InternalTokenGuard } from '../payment/payment.controller';
import { PaymentModule } from '../payment/payment.module';
import { AppError } from '../shared/errors/app-error';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { WaitingRoomService } from './waiting-room.service';

/**
 * 429 (not 503) so queueing during a sale never counts towards the 5xx alert.
 * Put after AccessTokenGuard on routes that start a checkout. Queued shoppers get 429
 * WAITING_ROOM with {position, retryAfterSeconds} and a Retry-After header; the web app then
 * shows /queue, which polls GET /waiting-room/status.
 */
@Injectable()
export class WaitingRoomGuard implements CanActivate {
  constructor(private readonly room: WaitingRoomService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const userId = (req as Request & { auth?: AccessClaims }).auth?.sub;
    if (!userId) return true;
    const status = await this.room.admit(userId);
    if (status.admitted) return true;
    ctx
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(status.retryAfterSeconds));
    throw new AppError(
      'WAITING_ROOM',
      'High demand right now. You are in the queue for checkout.',
      HttpStatus.TOO_MANY_REQUESTS,
      { position: status.position, retryAfterSeconds: status.retryAfterSeconds },
    );
  }
}

const flagSchema = z.object({ state: z.enum(['on', 'off', 'env']) });

@Controller('waiting-room')
export class WaitingRoomController {
  constructor(private readonly room: WaitingRoomService) {}

  /** Polled by the queue page; each poll may admit the shopper. */
  @Get('status')
  @UseGuards(AccessTokenGuard)
  @SkipRateLimit()
  @Header('Cache-Control', 'no-store')
  status(@Auth() auth: AccessClaims): Promise<WaitingRoomStatus> {
    return this.room.admit(auth.sub);
  }

  /** Ops toggle for the feature flag (overrides WAITING_ROOM_ENABLED until reset with "env"). */
  @Post('internal/flag')
  @HttpCode(200)
  @SkipRateLimit()
  @UseGuards(InternalTokenGuard)
  async flag(@Body() body: unknown): Promise<{ enabled: boolean }> {
    await this.room.setFlag(flagSchema.parse(body).state);
    return { enabled: await this.room.enabled() };
  }
}

@Module({
  imports: [IdentityModule, PaymentModule],
  controllers: [WaitingRoomController],
  providers: [WaitingRoomService, WaitingRoomGuard],
  exports: [WaitingRoomService, WaitingRoomGuard],
})
export class WaitingRoomModule {}
