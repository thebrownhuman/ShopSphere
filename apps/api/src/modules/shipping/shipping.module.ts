import { Module } from '@nestjs/common';
import { CourierRegistry } from './courier.registry';
import { ServiceabilityService } from './serviceability.service';
import { loadShippingConfig, SHIPPING_CONFIG } from './shipping.config';

/**
 * Shipping (M5.6, M5.6a): courier adapters behind CourierProvider and the serviceability
 * snapshot. Order/shipment state lives in fulfilment; this module has no tables of its own
 * beyond courier_serviceability.
 */
@Module({
  providers: [
    { provide: SHIPPING_CONFIG, useFactory: () => loadShippingConfig(process.env) },
    CourierRegistry,
    ServiceabilityService,
  ],
  exports: [CourierRegistry, ServiceabilityService, SHIPPING_CONFIG],
})
export class ShippingModule {}
