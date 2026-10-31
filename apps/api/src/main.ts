import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './modules/shared/config/config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);
  app.enableCors({
    origin: config.get('CORS_ORIGINS').split(','),
    exposedHeaders: ['x-request-id'],
  });
  app.enableShutdownHooks();
  await app.listen(config.get('PORT'));
}

void bootstrap();
