import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { validate } from './env.config';
import { DrizzleModule } from './modules/shared/drizzle/drizzle.module';
import { BidsModule } from './modules/bids/bids.module';
import { CatsModule } from './modules/cats/cats.module';
import { ListingsModule } from './modules/listings/listings.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ScheduleModule.forRoot(),
    // Throttler set up but NOT registered as a global guard. Individual
    // routes opt in via @UseGuards(ThrottlerGuard) + @Throttle(...).
    // Keeps the high-traffic browse endpoints (/cats, /cats/numbers,
    // /cats/search) un-rate-limited; only the abuse-prone endpoints
    // (currently /cats/search/random) get bounded.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    DrizzleModule,
    CatsModule,
    SyncModule,
    ListingsModule,
    BidsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
