import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { HelpArticle, SupportTicket } from '@shopsphere/types';
import { z } from 'zod';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { AppError } from '../shared/errors/app-error';
import { SupportService } from './support.service';

const ticketSchema = z.object({
  category: z.enum(['ORDER', 'RETURN', 'PAYMENT', 'ACCOUNT', 'OTHER']),
  orderId: z.string().optional(),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(4000),
});

/** Public help centre articles. */
@Controller('help/articles')
export class HelpController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query('q') q?: string): { items: HelpArticle[] } {
    return { items: this.support.articles(q) };
  }

  @Get(':slug')
  get(@Param('slug') slug: string): HelpArticle {
    return this.support.article(slug);
  }
}

@Controller('support/tickets')
@UseGuards(AccessTokenGuard)
export class SupportTicketsController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Auth() auth: AccessClaims): Promise<{ items: SupportTicket[] }> {
    return this.support.list(auth.sub);
  }

  @Post()
  create(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<SupportTicket> {
    const r = ticketSchema.safeParse(body);
    if (!r.success) throw new AppError('VALIDATION_FAILED', 'Invalid request', 422, r.error.issues);
    return this.support.create(auth.sub, r.data);
  }
}
