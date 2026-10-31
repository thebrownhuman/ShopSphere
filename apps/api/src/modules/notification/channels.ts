import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { smsMailbox } from '../identity/notify/dev-notification.provider';
import { NOTIFICATION_CONFIG, type NotificationConfig } from './notification.config';

export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');

/**
 * Delivery channels. Real adapters (SES, MSG91/Twilio) implement this; dev uses MailpitChannels.
 * Errors propagate so the event is retried (sends are deduped per event id).
 */
export interface NotificationChannels {
  email(to: string, subject: string, text: string): Promise<void>;
  sms(phone: string, text: string): Promise<void>;
  /** WhatsApp Business template message (M6.9). Dev: simulated, delivered to Mailpit. */
  whatsapp(phone: string, text: string): Promise<void>;
}

/** Mailpit inbox standing in for a WhatsApp number. */
export function whatsappMailbox(phone: string): string {
  return `wa-${phone.replace('+', '')}@whatsapp.shopsphere.test`;
}

/**
 * Simulation channels, same scheme as identity's DevNotificationProvider: email goes to Mailpit
 * at the real address, SMS goes to Mailpit at smsMailbox(phone) and WhatsApp to
 * whatsappMailbox(phone), so texts are visible locally. A real WhatsApp Business API adapter
 * (Gupshup/Meta Cloud API) implements the same method.
 */
@Injectable()
export class MailpitChannels implements NotificationChannels {
  private readonly logger = new Logger('Notifications');
  private readonly transport: Transporter;

  constructor(@Inject(NOTIFICATION_CONFIG) private readonly cfg: NotificationConfig) {
    this.transport = createTransport({ host: cfg.SMTP_HOST, port: cfg.SMTP_PORT, secure: false });
  }

  async email(to: string, subject: string, text: string): Promise<void> {
    this.logger.log(`[email] ${to}: ${subject}`);
    await this.transport.sendMail({ from: this.cfg.MAIL_FROM, to, subject, text });
  }

  async sms(phone: string, text: string): Promise<void> {
    this.logger.log(`[sms] ${phone}: ${text}`);
    await this.transport.sendMail({
      from: this.cfg.MAIL_FROM,
      to: smsMailbox(phone),
      subject: `SMS to ${phone}`,
      text,
    });
  }

  async whatsapp(phone: string, text: string): Promise<void> {
    this.logger.log(`[whatsapp] ${phone}: ${text}`);
    await this.transport.sendMail({
      from: this.cfg.MAIL_FROM,
      to: whatsappMailbox(phone),
      subject: `WhatsApp to ${phone}`,
      text,
    });
  }
}
