import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { ApiController } from './api/api.controller';
import { configuration, validationSchema } from './app.configuration';
import { AppController } from './app.controller';
import { BlockchairApiService } from './model/blockchair-api.service';
import { CacheService } from './model/cache.service';
import { CatService } from './model/cat.service';
import { EsploraApiService } from './model/esplora-api.service';


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
    BlockchairApiService,
    EsploraApiService
  ]
})
export class AppModule { }


