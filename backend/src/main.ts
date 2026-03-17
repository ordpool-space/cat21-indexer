import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import helmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  // Public read-only API — permissive CORP so <img> tags work cross-origin
  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  setupSwagger(app);

  const cfg = app.get(ConfigService);
  const port = cfg.get<number>('PORT', 3333);
  await app.listen(port, '0.0.0.0');
  console.log(`API  : http://localhost:${port}`);
  console.log(`Docs : http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
