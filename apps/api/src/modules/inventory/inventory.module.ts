import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';

/** Stock reservations over offers.reserved_qty (M4.1). Joins callers' transactions. */
@Module({ providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
