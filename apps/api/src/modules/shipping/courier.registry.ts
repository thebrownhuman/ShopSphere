import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../shared/errors/app-error';
import type { CourierProvider } from './providers/courier-provider';
import { CourierSimProvider } from './providers/courier-sim.provider';
import { SHIPPING_CONFIG, type ShippingConfig } from './shipping.config';

/** Courier adapters by name; `active` books new shipments, any registered one may send webhooks. */
@Injectable()
export class CourierRegistry {
  private readonly providers = new Map<string, CourierProvider>();

  constructor(@Inject(SHIPPING_CONFIG) private readonly cfg: ShippingConfig) {
    this.register(
      new CourierSimProvider({
        apiUrl: cfg.COURIER_API_URL,
        apiKey: cfg.COURIER_API_KEY,
        webhookSecret: cfg.COURIER_WEBHOOK_SECRET,
      }),
    );
  }

  /** Tests replace adapters with fakes. */
  register(p: CourierProvider): void {
    this.providers.set(p.name, p);
  }

  get active(): CourierProvider {
    return this.get(this.cfg.COURIER_PROVIDER);
  }

  get(name: string): CourierProvider {
    const p = this.providers.get(name);
    if (!p) throw new AppError('NOT_FOUND', `Unknown courier ${name}`, HttpStatus.NOT_FOUND);
    return p;
  }
}
