import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { ApiController } from './api/api.controller';
import { TestnetApiController } from './api/testnet-api.controller';

import { configuration, validationSchema } from './app.configuration';
import { AppController } from './app.controller';
import { BlockchairApiService } from './model/blockchair-api.service';
import { CatService } from './model/cat.service';
import { EsploraApiService } from './model/esplora-api.service';
import { OrdApiService } from './model/ord-api.service';


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
    ApiController,
    TestnetApiController
  ],
  providers: [
    BlockchairApiService,
    EsploraApiService,
    OrdApiService,

    // registers CatService for mainnet and testnet
    ...['', 'testnet'].map((network: '' | 'testnet') => ({
      provide: network,
      useFactory: (
        blockchairApi: BlockchairApiService,
        esploraApi: EsploraApiService,
        ordApi: OrdApiService
      ) => {
        return new CatService(network, blockchairApi, esploraApi, ordApi);
      },
      inject: [BlockchairApiService, EsploraApiService, OrdApiService]
    })),
  ]
})
export class AppModule { }


