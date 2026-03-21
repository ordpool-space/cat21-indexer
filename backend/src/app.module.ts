import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { validate } from './env.config';
import { DrizzleModule } from './modules/shared/drizzle/drizzle.module';
import { CatsModule } from './modules/cats/cats.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ScheduleModule.forRoot(),
    DrizzleModule,
    CatsModule,
    SyncModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
