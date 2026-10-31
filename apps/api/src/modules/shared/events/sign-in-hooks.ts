import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

export interface SignInEvent {
  userId: string;
  req: Request;
  res: Response;
}

export type SignInHook = (event: SignInEvent) => Promise<void>;

/**
 * Synchronous "user just signed in" extension point. Identity calls `run` after every successful
 * sign-in (OTP, password, MFA, Google); other modules `register` without identity importing them
 * (e.g. cart merges the guest cart, M3.5). A failing hook is logged and never blocks sign-in.
 */
@Injectable()
export class SignInHooks {
  private readonly logger = new Logger(SignInHooks.name);
  private readonly hooks: SignInHook[] = [];

  register(hook: SignInHook): void {
    this.hooks.push(hook);
  }

  async run(event: SignInEvent): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook(event);
      } catch (err) {
        this.logger.error(`sign-in hook failed for ${event.userId}`, err as Error);
      }
    }
  }
}
