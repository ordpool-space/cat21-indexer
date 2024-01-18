import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { ApiController } from './api/api.controller';
import { configuration, validationSchema } from './app.configuration';
import { AppController } from './app.controller';
import { CacheService } from './model/cache.service';
import { CatService } from './model/cat.service';
import { BlockchairApiService } from './model/blockchair-api.service';
import { ScheduleModule } from '@nestjs/schedule';


@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, 'assets/public'),
      serveRoot: '/public',
      serveStaticOptions: {
        index: false,
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema
    }),
    ScheduleModule.forRoot()
  ],
  controllers: [
    AppController,
    ApiController
  ],
  providers: [
    CacheService,
    CatService,
    BlockchairApiService
  ]
})
export class AppModule { }


