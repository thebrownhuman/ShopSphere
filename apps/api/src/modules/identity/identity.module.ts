import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { ContactLookupService } from './account/contact-lookup.service';
import { PincodeController } from './account/pincode.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { GoogleService } from './auth/google.service';
import { IdentityConfig } from './identity.config';
import { DevNotificationProvider } from './notify/dev-notification.provider';
import { NOTIFICATION_PROVIDER } from './notify/notification.provider';
import { OtpService } from './otp/otp.service';
import { AccessTokenGuard } from './security/access-token.guard';
import { CaptchaService } from './security/captcha.service';
import { CookiesService } from './security/cookies.service';
import { LoginThrottleService } from './security/login-throttle.service';
import { SessionService } from './tokens/session.service';

/**
 * Identity & accounts (M1): OTP / password / Google sign-in, rotating refresh sessions,
 * Login & Security, addresses. Other modules use AccessTokenGuard + Auth to get the caller.
 */
@Module({
  controllers: [AuthController, AccountController, PincodeController],
  providers: [
    IdentityConfig,
    { provide: NOTIFICATION_PROVIDER, useClass: DevNotificationProvider },
    OtpService,
    SessionService,
    AuthService,
    GoogleService,
    AccountService,
    CookiesService,
    LoginThrottleService,
    CaptchaService,
    AccessTokenGuard,
    ContactLookupService,
  ],
  exports: [SessionService, AccessTokenGuard, ContactLookupService, CaptchaService],
})
export class IdentityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(cookieParser()).forRoutes('*');
  }
}
