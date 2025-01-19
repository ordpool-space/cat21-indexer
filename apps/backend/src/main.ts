import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppModule } from './app/app.module';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { schedule } from '../../shared/schedule';

const port = process.env.PORT || 3000; // see .env file

async function bootstrap() {
  const app = await await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  const openApiConfig = new DocumentBuilder()
    .setTitle('🟧 CAT-21 Indexer API')
    .setDescription('Meow! Rescue the cats!')
    .setVersion('1.0')
    .build();

  // hides Open API until public mint - requires a server restart
  // if (new Date() > new Date(schedule.Public.start)) {
    const document = SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup('open-api', app, document);
  // }

  // https://docs.nestjs.com/security/cors
  app.enableCors();
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

  app.useBodyParser('text', { limit: '10mb' });

  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${ port }/`);
  Logger.log(`🚀 Running in ${ config.get('environment') } mode`);
}

bootstrap();
