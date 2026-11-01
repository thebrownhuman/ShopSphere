import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { config } from './config';
import { securityHeaders } from './security-headers';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(securityHeaders);
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(
    `ShopSphere courier simulator on http://localhost:${config.port} (step ${config.stepMs} ms)`,
    'courier-sim',
  );
}

void bootstrap();
