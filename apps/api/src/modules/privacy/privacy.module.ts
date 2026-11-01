import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MailpitChannels, NOTIFICATION_CHANNELS } from '../notification/channels';
import { loadNotificationConfig, NOTIFICATION_CONFIG } from '../notification/notification.config';
import { PrivacyExportStore, S3PrivacyExportStore } from './export.store';
import {
  PrivacyController,
  PrivacyInternalController,
  PrivacyInternalGuard,
} from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { PrivacyWorker } from './privacy.worker';

/** DPDP Act data export + account deletion (M7.3). */
@Module({
  imports: [IdentityModule, LedgerModule],
  controllers: [PrivacyController, PrivacyInternalController],
  providers: [
    { provide: NOTIFICATION_CONFIG, useFactory: () => loadNotificationConfig(process.env) },
    { provide: NOTIFICATION_CHANNELS, useClass: MailpitChannels },
    { provide: PrivacyExportStore, useClass: S3PrivacyExportStore },
    PrivacyInternalGuard,
    PrivacyService,
    PrivacyWorker,
  ],
})
export class PrivacyModule {}
