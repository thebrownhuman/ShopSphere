import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminAuditInterceptor, Roles, Staff, StaffGuard, type StaffClaims } from '../admin/rbac';
import { FraudService } from './fraud.service';

const listSchema = z.object({
  status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'NONE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const reviewSchema = z.object({ note: z.string().max(500).optional() }).strict();

/** Fraud review queue (M7.2). Support staff decide held orders; every decision is audited. */
@Controller('admin/fraud')
@UseGuards(StaffGuard)
@UseInterceptors(AdminAuditInterceptor)
@Roles('SUPPORT')
export class FraudAdminController {
  constructor(private readonly fraud: FraudService) {}

  @Get('thresholds')
  thresholds() {
    return this.fraud.thresholds();
  }

  @Get('assessments')
  list(@Query() q: unknown) {
    return this.fraud.list(listSchema.parse(q));
  }

  @Post('assessments/:id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Staff() staff: StaffClaims,
    @Body() body: unknown,
  ) {
    return this.fraud.approve(id, staff.userId, reviewSchema.parse(body ?? {}).note);
  }

  @Post('assessments/:id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Staff() staff: StaffClaims,
    @Body() body: unknown,
  ) {
    return this.fraud.reject(id, staff.userId, reviewSchema.parse(body ?? {}).note);
  }
}
