import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('CAT-21 Backend')
    .setDescription('REST API for CAT-21 cat data with traits')
    .setVersion('0.1.0')
    .addServer('http://localhost:3333', 'Development')
    .addServer('https://backend.cat21.space', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}
