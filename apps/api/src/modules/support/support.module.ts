import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { HelpController, SupportTicketsController } from './support.controller';
import { SupportService } from './support.service';

/** Help centre + support tickets (M6.8). */
@Module({
  imports: [IdentityModule],
  controllers: [HelpController, SupportTicketsController],
  providers: [SupportService],
})
export class SupportModule {}
