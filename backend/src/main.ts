import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import helmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import * as sharp from 'sharp';
import { AppModule } from './app.module';
import { NoStoreOnErrorFilter } from './modules/shared/no-store-on-error.filter';
import { setupSwagger } from './swagger';

// Minimize Sharp memory usage on low-memory environments (512MB)
sharp.cache(false);
sharp.concurrency(1);

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // trustProxy: '127.0.0.1' — production traffic enters via cloudflared
    // on loopback. With this, request.ip becomes the first X-Forwarded-For
    // hop (the real client). Without it, every caller looks like
    // 127.0.0.1 and any future rate-limit / abuse logging is blind.
    new FastifyAdapter({ logger: false, trustProxy: '127.0.0.1' }),
  );

  // Public read-only API — permissive CORP so <img> tags work cross-origin
  // CSP disabled: not needed for API backend, breaks Swagger UI
  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  });

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Guards / pipes / interceptors throw BEFORE the controller method
  // body runs, so any Cache-Control the controller would have set via
  // `reply.header(...)` never lands on the response. This filter is
  // the single place every error path picks up `no-store`.
  app.useGlobalFilters(new NoStoreOnErrorFilter(app.get(HttpAdapterHost)));

  setupSwagger(app);

  const cfg = app.get(ConfigService);
  const port = cfg.get<number>('PORT', 3333);
  const host = cfg.get<string>('HOST', '0.0.0.0');
  await app.listen(port, host);
  console.log(`API  : http://${host}:${port}`);
  console.log(`Docs : http://${host}:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
