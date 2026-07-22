import { Module } from '@nestjs/common';

import { DrizzleModule } from '../shared/drizzle/drizzle.module';
import { SyncModule } from '../sync/sync.module';
import { BidsController } from './bids.controller';
import { BidsPruner } from './bids.pruner';
import { BidsService } from './bids.service';

@Module({
  imports: [DrizzleModule, SyncModule],
  controllers: [BidsController],
  providers: [BidsService, BidsPruner],
  exports: [BidsService],
})
export class BidsModule {}
