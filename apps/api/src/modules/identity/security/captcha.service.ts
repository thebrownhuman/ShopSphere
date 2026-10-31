import { Injectable, Logger } from '@nestjs/common';
import { IdentityConfig } from '../identity.config';

/** Turnstile documented test keys: this secret always passes, the widget returns the dummy token. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';
export const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly config: IdentityConfig) {}

  async verify(token: string | undefined, ip?: string): Promise<boolean> {
    if (!token) return false;
    const secret = this.config.env.TURNSTILE_SECRET_KEY;
    // Test keys: skip the network round-trip so dev/test runs offline.
    if (secret === TURNSTILE_TEST_SECRET) return token === TURNSTILE_DUMMY_TOKEN;
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      });
      const body = (await res.json()) as { success?: boolean };
      return body.success === true;
    } catch (err) {
      this.logger.warn(`turnstile verify failed: ${(err as Error).message}`);
      return false;
    }
  }
}
