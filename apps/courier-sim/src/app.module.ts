import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CourierApiController, CourierErrorFilter } from './api.controller';
import { CourierService } from './courier.service';

@Module({
  controllers: [CourierApiController],
  providers: [CourierService, { provide: APP_FILTER, useClass: CourierErrorFilter }],
})
export class AppModule {}
