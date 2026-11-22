import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { setupApp } from './setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // El cuerpo tal cual llega: hace falta para comprobar la firma de los avisos de cobro.
    rawBody: true,
  });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  setupApp(app);
  // Detrás de un proxy inverso, la IP real llega en X-Forwarded-For.
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`API escuchando en http://localhost:${port}/api/v1`);
}

void bootstrap();
