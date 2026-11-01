import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrivacyService } from './privacy.service';

const SWEEP_MS = 5 * 60_000;

/**
 * In-process schedule for privacy housekeeping: stuck exports, due deletions, expired archives.
 * Also POST /privacy/internal/sweep. Off with PRIVACY_WORKERS_ENABLED=false.
 */
@Injectable()
export class PrivacyWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrivacyWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly privacy: PrivacyService) {}

  onModuleInit(): void {
    if (process.env.PRIVACY_WORKERS_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.tick(), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.privacy.sweep();
      if (r.exported || r.deleted || r.expired) this.log.log(r, 'privacy sweep');
    } catch (err) {
      this.log.warn(`privacy sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
