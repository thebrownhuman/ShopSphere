import {
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { PrivacyDeletion, PrivacyExport, PrivacyOverview } from '@shopsphere/types';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { AppError } from '../shared/errors/app-error';
import { RateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { PrivacyService } from './privacy.service';

/** x-internal-token = CATALOG_INTERNAL_TOKEN (shared by the workers' internal calls). */
@Injectable()
export class PrivacyInternalGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.CATALOG_INTERNAL_TOKEN ?? '';
    const given = Buffer.from(
      ctx.switchToHttp().getRequest<Request>().header('x-internal-token') ?? '',
    );
    const want = Buffer.from(expected);
    if (!expected || given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new AppError('UNAUTHORIZED', 'Internal token required', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}

/** DPDP data-principal rights (M7.3). Contract: packages/types/src/privacy.ts. */
@Controller('me')
@UseGuards(AccessTokenGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('privacy')
  overview(@Auth() a: AccessClaims): Promise<PrivacyOverview> {
    return this.privacy.overview(a.sub);
  }

  @Post('export')
  @HttpCode(202)
  @RateLimit({ limit: 5, windowSeconds: 3600 })
  requestExport(@Auth() a: AccessClaims): Promise<PrivacyExport> {
    return this.privacy.requestExport(a.sub);
  }

  @Get('export')
  latestExport(@Auth() a: AccessClaims): Promise<PrivacyExport> {
    return this.privacy.latestExport(a.sub);
  }

  @Post('delete-account')
  @HttpCode(202)
  requestDeletion(@Auth() a: AccessClaims): Promise<PrivacyDeletion> {
    return this.privacy.requestDeletion(a.sub, a.sid);
  }

  @Delete('delete-account')
  @HttpCode(204)
  cancelDeletion(@Auth() a: AccessClaims): Promise<void> {
    return this.privacy.cancelDeletion(a.sub);
  }
}

@Controller('privacy/internal')
@UseGuards(PrivacyInternalGuard)
export class PrivacyInternalController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post('sweep')
  @HttpCode(200)
  sweep() {
    return this.privacy.sweep();
  }
}
