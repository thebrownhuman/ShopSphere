import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AnswerView,
  QuestionPage,
  QuestionView,
  SellerQuestionPage,
} from '@shopsphere/types';
import { z } from 'zod';
import { SellerGuard, SellerId } from '../fulfilment/seller.guard';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { RateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { QaService } from './qa.service';

const listSchema = z.object({
  q: z.string().max(100).optional(),
  cursor: z.string().max(12).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const questionSchema = z.object({ body: z.string().trim().min(10).max(500) });
const answerSchema = z.object({ body: z.string().trim().min(2).max(1000) });
const sellerListSchema = z.object({
  status: z.enum(['unanswered', 'answered', 'all']).optional(),
  cursor: z.string().max(12).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** PDP questions (M6.3). */
@Controller('products/:productId/questions')
export class ProductQuestionsController {
  constructor(private readonly qa: QaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() q: unknown,
  ): Promise<QuestionPage> {
    return this.qa.list(productId, listSchema.parse(q));
  }

  @Post()
  @UseGuards(AccessTokenGuard)
  @RateLimit({ limit: 20, windowSeconds: 3600 })
  ask(
    @Auth() auth: AccessClaims,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ): Promise<QuestionView> {
    return this.qa.ask(auth.sub, productId, questionSchema.parse(body).body);
  }
}

@Controller('questions')
@UseGuards(AccessTokenGuard)
export class QuestionAnswersController {
  constructor(private readonly qa: QaService) {}

  @Post(':id/answers')
  @RateLimit({ limit: 30, windowSeconds: 3600 })
  answer(
    @Auth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AnswerView> {
    return this.qa.customerAnswer(auth.sub, id, answerSchema.parse(body).body);
  }
}

/** Seller Central answers page. */
@Controller('seller/questions')
@UseGuards(SellerGuard)
export class SellerQuestionsController {
  constructor(private readonly qa: QaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@SellerId() sellerId: string, @Query() q: unknown): Promise<SellerQuestionPage> {
    return this.qa.sellerQuestions(sellerId, sellerListSchema.parse(q));
  }

  @Post(':id/answers')
  answer(
    @Auth() auth: AccessClaims,
    @SellerId() sellerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<AnswerView> {
    return this.qa.sellerAnswer(auth.sub, sellerId, id, answerSchema.parse(body).body);
  }
}
