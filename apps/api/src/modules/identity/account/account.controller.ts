import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import { AuthService } from '../auth/auth.service';
import {
  addressSchema,
  addressUpdateSchema,
  changeIdentifierConfirmSchema,
  changeIdentifierRequestSchema,
  changePasswordSchema,
  profileSchema,
  reauthSchema,
  totpCodeSchema,
} from '../dto';
import { AccessTokenGuard, Auth } from '../security/access-token.guard';
import { CookiesService } from '../security/cookies.service';
import type { AccessClaims } from '../tokens/session.service';
import { AccountService } from './account.service';

@Controller('me')
@UseGuards(AccessTokenGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly auth: AuthService,
    private readonly cookies: CookiesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  me(@Auth() a: AccessClaims) {
    return this.auth.getAuthUser(a.sub);
  }

  @Patch()
  async updateProfile(
    @Auth() a: AccessClaims,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.account.updateProfile(a.sub, profileSchema.parse(body).name);
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: a.sid } });
    const maxAge = session.persistent ? session.expiresAt.getTime() - Date.now() : undefined;
    this.cookies.setProfile(res, user, session.expiresAt, maxAge);
    return user;
  }

  @Get('sessions')
  sessions(@Auth() a: AccessClaims) {
    return this.account.listSessions(a.sub, a.sid);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revokeSession(@Auth() a: AccessClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.revokeSession(a.sub, id);
  }

  @Post('reauth/otp')
  @HttpCode(200)
  @RateLimit({ limit: 5, windowSeconds: 15 * 60 })
  reauthOtp(@Auth() a: AccessClaims) {
    return this.account.requestReauthOtp(a.sub);
  }

  @Post('reauth')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 15 * 60 })
  reauth(@Auth() a: AccessClaims, @Body() body: unknown) {
    return this.account.reauth(a.sub, a.sid, reauthSchema.parse(body));
  }

  @Post('password')
  @HttpCode(200)
  changePassword(@Auth() a: AccessClaims, @Body() body: unknown) {
    return this.account.changePassword(a.sub, a.sid, changePasswordSchema.parse(body).newPassword);
  }

  @Post('totp/setup')
  @HttpCode(200)
  setupTotp(@Auth() a: AccessClaims) {
    return this.account.setupTotp(a.sub, a.sid);
  }

  @Post('totp/enable')
  @HttpCode(200)
  enableTotp(@Auth() a: AccessClaims, @Body() body: unknown) {
    return this.account.enableTotp(a.sub, totpCodeSchema.parse(body).code);
  }

  @Post('totp/disable')
  @HttpCode(200)
  disableTotp(@Auth() a: AccessClaims) {
    return this.account.disableTotp(a.sub, a.sid);
  }

  @Post('identifier/change/request')
  @HttpCode(200)
  @RateLimit({ limit: 5, windowSeconds: 15 * 60 })
  requestChange(@Auth() a: AccessClaims, @Body() body: unknown) {
    const { identifier } = changeIdentifierRequestSchema.parse(body);
    return this.account.requestIdentifierChange(a.sub, a.sid, identifier);
  }

  @Post('identifier/change/confirm')
  @HttpCode(200)
  confirmChange(@Auth() a: AccessClaims, @Body() body: unknown) {
    const { identifier, code } = changeIdentifierConfirmSchema.parse(body);
    return this.account.confirmIdentifierChange(a.sub, a.sid, identifier, code);
  }

  @Get('addresses')
  addresses(@Auth() a: AccessClaims) {
    return this.account.listAddresses(a.sub);
  }

  @Post('addresses')
  createAddress(@Auth() a: AccessClaims, @Body() body: unknown) {
    return this.account.createAddress(a.sub, addressSchema.parse(body));
  }

  @Patch('addresses/:id')
  updateAddress(
    @Auth() a: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.account.updateAddress(a.sub, id, addressUpdateSchema.parse(body));
  }

  @Post('addresses/:id/default')
  @HttpCode(200)
  setDefault(@Auth() a: AccessClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.setDefaultAddress(a.sub, id);
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  deleteAddress(@Auth() a: AccessClaims, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.deleteAddress(a.sub, id);
  }
}
