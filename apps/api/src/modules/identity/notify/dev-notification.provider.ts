import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { IdentityConfig } from '../identity.config';
import type { NotificationProvider, OutboundMessage } from './notification.provider';

/** Mailpit address that stands in for an SMS inbox, so phone OTPs are visible locally. */
export function smsMailbox(phone: string): string {
  return `sms-${phone.replace('+', '')}@sms.shopsphere.test`;
}

/**
 * Simulation provider: logs every message and delivers it to Mailpit.
 * Email goes to the real address; SMS goes to smsMailbox(phone).
 */
@Injectable()
export class DevNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger('DevNotifications');
  private readonly transport: Transporter;

  constructor(private readonly config: IdentityConfig) {
    this.transport = createTransport({
      host: config.env.SMTP_HOST,
      port: config.env.SMTP_PORT,
      secure: false,
    });
  }

  async send({ to, subject, text }: OutboundMessage): Promise<void> {
    this.logger.log(`[${to.type}] ${to.value}: ${text}`);
    const address = to.type === 'email' ? to.value : smsMailbox(to.value);
    try {
      await this.transport.sendMail({
        from: this.config.env.MAIL_FROM,
        to: address,
        subject,
        text,
      });
    } catch (err) {
      // Simulation only: the log line above is the fallback channel.
      this.logger.warn(`mail delivery failed: ${(err as Error).message}`);
    }
  }
}
