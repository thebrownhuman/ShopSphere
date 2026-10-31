import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

/** Closed-loop gift card / store balance ledger (M4.7). */
@Module({
  imports: [IdentityModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
