import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { AuthResponse } from '@shopsphere/types';
import type { Request, Response } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { RateLimit } from '../../shared/rate-limit/rate-limit.decorator';
import {
  forgotSchema,
  identifySchema,
  loginSchema,
  mfaSchema,
  otpRequestSchema,
  otpVerifySchema,
  resetSchema,
  signupSchema,
} from '../dto';
import { IdentityConfig } from '../identity.config';
import { COOKIES, CookiesService } from '../security/cookies.service';
import { CsrfGuard } from '../security/csrf.guard';
import { SessionService, type SessionContext } from '../tokens/session.service';
import { AuthService, type AuthResult } from './auth.service';
import { GoogleService } from './google.service';

/** Only same-site relative paths, so return-to cannot become an open redirect. */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && /^\/(?!\/)[^\\\s]*$/.test(value) ? value : '/';
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly cookies: CookiesService,
    private readonly google: GoogleService,
    private readonly config: IdentityConfig,
  ) {}

  @Post('identify')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSeconds: 60 })
  identify(@Body() body: unknown) {
    return this.auth.identify(identifySchema.parse(body).identifier);
  }

  @Post('otp/request')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 15 * 60 })
  requestOtp(@Body() body: unknown) {
    return this.auth.requestLoginOtp(otpRequestSchema.parse(body).identifier);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSeconds: 15 * 60 })
  async verifyOtp(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { identifier, code, keepSignedIn } = otpVerifySchema.parse(body);
    const result = await this.auth.verifyLoginOtp(
      identifier,
      code,
      keepSignedIn,
      this.ctx(req, res),
    );
    return this.respond(result, res);
  }

  @Post('signup')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 15 * 60 })
  async signup(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { signupToken, name, password } = signupSchema.parse(body);
    const result = await this.auth.completeSignup(signupToken, name, password, this.ctx(req, res));
    return this.respond(result, res);
  }

  @Post('login')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSeconds: 15 * 60 })
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { identifier, password, keepSignedIn, captchaToken } = loginSchema.parse(body);
    const result = await this.auth.loginWithPassword(
      identifier,
      password,
      keepSignedIn,
      captchaToken,
      this.ctx(req, res),
    );
    return this.respond(result, res);
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSeconds: 15 * 60 })
  async mfa(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { mfaToken, code } = mfaSchema.parse(body);
    return this.respond(await this.auth.verifyMfa(mfaToken, code, this.ctx(req, res)), res);
  }

  @Post('password/forgot')
  @HttpCode(200)
  @RateLimit({ limit: 5, windowSeconds: 15 * 60 })
  forgot(@Body() body: unknown) {
    return this.auth.forgotPassword(forgotSchema.parse(body).identifier);
  }

  @Post('password/reset')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 15 * 60 })
  async reset(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { identifier, code, newPassword } = resetSchema.parse(body);
    await this.auth.resetPassword(identifier, code, newPassword);
    this.cookies.clearSession(res);
    return { ok: true };
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = req.cookies?.[COOKIES.refresh] as string | undefined;
    if (!token) throw new AppError('INVALID_REFRESH_TOKEN', 'Please sign in again', 401);
    try {
      const tokens = await this.sessions.refresh(token);
      const user = await this.auth.getAuthUser(
        (await this.sessions.authenticate(tokens.accessToken)).sub,
      );
      this.cookies.setSession(res, tokens, user);
      return {
        status: 'authenticated',
        accessToken: tokens.accessToken,
        expiresIn: tokens.accessTokenExpiresIn,
        user,
      };
    } catch (err) {
      this.cookies.clearSession(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIES.refresh] as string | undefined;
    if (token) await this.sessions.revokeByRefreshToken(token, 'logout');
    this.cookies.clearSession(res);
    return { ok: true };
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIES.refresh] as string | undefined;
    if (!token) throw new AppError('INVALID_REFRESH_TOKEN', 'Please sign in again', 401);
    const tokens = await this.sessions.refresh(token);
    const { sub } = await this.sessions.authenticate(tokens.accessToken);
    const revoked = await this.sessions.revokeAll(sub, 'logout_all');
    this.cookies.clearSession(res);
    return { ok: true, revoked };
  }

  @Get('google/status')
  googleStatus() {
    return { enabled: this.google.enabled };
  }

  @Get('google')
  async googleStart(@Query('returnTo') returnTo: string | undefined, @Res() res: Response) {
    res.redirect(await this.google.authorizationUrl(safeReturnTo(returnTo)));
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const web = this.config.env.WEB_URL;
    try {
      const { returnTo, profile } = await this.google.exchange(code, state);
      const result = await this.auth.loginWithGoogle(profile, this.ctx(req, res));
      if (result.status === 'mfa_required') {
        return res.redirect(
          `${web}/signin?mfa=${encodeURIComponent(result.mfaToken)}&returnTo=${encodeURIComponent(returnTo)}`,
        );
      }
      if (result.status === 'authenticated') {
        this.cookies.setSession(res, result.tokens, result.user);
      }
      // The web app picks up the session via /auth/refresh on load.
      return res.redirect(`${web}${returnTo}`);
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'GOOGLE_FAILED';
      return res.redirect(`${web}/signin?error=${code}`);
    }
  }

  private ctx(req: Request, res: Response): SessionContext {
    return {
      ip: req.ip,
      userAgent: req.header('user-agent'),
      deviceId: this.cookies.deviceId(req, res),
    };
  }

  private async respond(result: AuthResult, res: Response): Promise<AuthResponse> {
    if (result.status !== 'authenticated') return result;
    const user = await this.auth.getAuthUser(result.user.id);
    this.cookies.setSession(res, result.tokens, user);
    return {
      status: 'authenticated',
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.accessTokenExpiresIn,
      user,
    };
  }
}
