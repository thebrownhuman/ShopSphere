import type { Identifier } from '../identifiers';

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');

export interface OutboundMessage {
  to: Identifier;
  subject: string;
  text: string;
}

/**
 * SMS + email delivery for identity. Real adapters (MSG91/Twilio, SES) implement this;
 * dev uses DevNotificationProvider.
 */
export interface NotificationProvider {
  send(message: OutboundMessage): Promise<void>;
}
