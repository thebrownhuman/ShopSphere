import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../shared/errors/app-error';
import { PROVIDERS, ProviderName } from '../domain/payment.types';
import { PAYMENT_CONFIG, PaymentConfig } from '../payment.config';
import { BankProvider } from './bank.provider';
import type { PaymentProvider } from './payment-provider';
import { RazorpayProvider } from './razorpay.provider';

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<ProviderName, PaymentProvider>();

  constructor(@Inject(PAYMENT_CONFIG) cfg: PaymentConfig) {
    this.providers.set(
      'bank',
      new BankProvider(
        {
          apiBaseUrl: cfg.BANK_API_URL,
          keyId: cfg.BANK_KEY_ID,
          keySecret: cfg.BANK_KEY_SECRET,
          webhookSecret: cfg.BANK_WEBHOOK_SECRET,
          signatureHeader: 'x-bank-signature',
          eventIdHeader: 'x-bank-event-id',
        },
        cfg.BANK_CHECKOUT_URL,
      ),
    );
    if (cfg.razorpay) {
      this.providers.set(
        'razorpay',
        new RazorpayProvider({
          apiBaseUrl: cfg.RAZORPAY_API_URL,
          ...cfg.razorpay,
          signatureHeader: 'x-razorpay-signature',
          eventIdHeader: 'x-razorpay-event-id',
        }),
      );
    }
  }

  /** Test hook: swap a provider for a fake. */
  register(provider: PaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): PaymentProvider {
    const provider = (PROVIDERS as readonly string[]).includes(name)
      ? this.providers.get(name as ProviderName)
      : undefined;
    if (!provider) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Payment provider "${name}" is not configured`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return provider;
  }

  available(): ProviderName[] {
    return [...this.providers.keys()];
  }
}
