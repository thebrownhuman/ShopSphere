import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './modules/shared/config/config.service';
import { sellerUploadBodyParser } from './modules/seller/seller.controller';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(AppConfig);
  app.enableCors({
    origin: config.get('CORS_ORIGINS').split(','),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  // Larger JSON bodies only on Seller Central upload routes (base64 images / sheets).
  app.use(...sellerUploadBodyParser());
  app.enableShutdownHooks();
  await app.listen(config.get('PORT'));
}

void bootstrap();
