import {
  Controller,
  Get,
  Global,
  Header,
  Injectable,
  Module,
  NestMiddleware,
  OnModuleInit,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { PrismaService } from '../prisma/prisma.service';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';
import { MetricsService } from './metrics.service';

/** Records every request once the response is sent; the route label is the matched pattern. */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const pattern = (req.route as { path?: string } | undefined)?.path;
      const route = pattern ? `${req.baseUrl}${pattern}` : 'unmatched';
      if (route === '/metrics') return;
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const labels = { method: req.method, route };
      this.metrics.httpRequests.inc({ ...labels, status: String(res.statusCode) });
      this.metrics.httpDuration.observe(labels, seconds);
    });
    next();
  }
}

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @SkipRateLimit()
  @Header('Content-Type', 'text/plain; version=0.0.4')
  @Header('Cache-Control', 'no-store')
  render(): Promise<string> {
    return this.metrics.render();
  }
}

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, HttpMetricsMiddleware],
  exports: [MetricsService],
})
export class MetricsModule implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // Shopper came back from the gateway (attempt AUTHORIZED via verify) but the capture/failure
    // webhook has not arrived yet: the age of the oldest such attempt is the webhook lag we alert on.
    this.metrics.gauge(
      'payment_webhook_backlog_oldest_seconds',
      'Age of the oldest payment attempt still waiting for its gateway webhook',
      async () => {
        const rows = await this.prisma.$queryRaw<{ age: number | null }[]>`
          SELECT EXTRACT(EPOCH FROM now() - min(created_at))::float8 AS age
          FROM payment_attempts
          WHERE status = 'AUTHORIZED' AND created_at > now() - interval '1 hour'`;
        return [{ value: rows[0]?.age ?? 0 }];
      },
    );
    // Event-loop delay p99 since the previous scrape: > 0.1 s means the API is CPU-bound.
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    this.metrics.gauge(
      'nodejs_eventloop_delay_p99_seconds',
      'Event-loop delay p99 since last scrape',
      () => {
        const v = loop.percentile(99) / 1e9;
        loop.reset();
        return Promise.resolve([{ value: v }]);
      },
    );
    this.metrics.gauge('process_resident_memory_bytes', 'Resident set size', () =>
      Promise.resolve([{ value: process.memoryUsage().rss }]),
    );
  }
}
