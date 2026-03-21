import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('CAT-21 Backend')
    .setDescription('REST API for CAT-21 cat data with traits')
    .setVersion('0.1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      defaultModelsExpandDepth: -1,    // hide schemas section at bottom
      defaultModelExpandDepth: 1,     // collapse nested models in responses
      docExpansion: 'list',           // collapse all endpoints by default
      tryItOutEnabled: true,          // enable "Try it out" by default
    },
  });
}
