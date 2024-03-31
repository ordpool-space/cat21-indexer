import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';

import { ApiController } from './api/api.controller';
import { TestnetApiController } from './api/testnet-api.controller';
import { WhitelistController } from './api/whitelist.controller';
import { configuration, validationSchema } from './app.configuration';
import { AppController } from './app.controller';
import { Cat21EntitiesService } from './database-entities/cat21.entities.service';
import { Cat21Entity } from './database-entities/cat21.entity';
import { MintTransactionEntitiesService } from './database-entities/mint-transaction.entities.service';
import { MintTransactionEntity } from './database-entities/mint-transaction.entity';
import { WhitelistEntitiesService } from './database-entities/whitelist.entities.service';
import { WhitelistEntity } from './database-entities/whitelist.entity';
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
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        logging: false,
        ...configService.get<{
            host: string,
            port: number,
            username: string,
            password: string,
            database: string}>('dbOptions'),
        entities: [
          WhitelistEntity,
          MintTransactionEntity,
          Cat21Entity
        ],
        synchronize: true, // TODO: disable again!
        ssl: true
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([WhitelistEntity, MintTransactionEntity, Cat21Entity])
  ],
  controllers: [
    AppController,
    ApiController,
    TestnetApiController,
    WhitelistController
  ],
  providers: [
    BlockchairApiService,
    EsploraApiService,
    OrdApiService,
    Cat21EntitiesService,
    MintTransactionEntitiesService,
    WhitelistEntitiesService,

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
