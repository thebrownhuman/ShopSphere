import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './modules/shared/config/config.service';
import { reviewUploadBodyParser } from './modules/review/review.controller';
import { sellerUploadBodyParser } from './modules/seller/seller.controller';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(AppConfig);
  const http = app.getHttpAdapter().getInstance() as {
    disable(k: string): void;
    set(k: string, v: unknown): void;
  };
  http.disable('x-powered-by');
  // Behind the edge/LB, req.ip must be the client (rate limits, fraud velocity). Hop count only.
  if (config.get('TRUST_PROXY_HOPS') > 0) http.set('trust proxy', config.get('TRUST_PROXY_HOPS'));
  app.enableCors({
    origin: config.get('CORS_ORIGINS').split(','),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  // Larger JSON bodies only on Seller Central upload routes (base64 images / sheets).
  app.use(...sellerUploadBodyParser());
  app.use(...reviewUploadBodyParser());
  app.enableShutdownHooks();
  await app.listen(config.get('PORT'));
}

void bootstrap();
