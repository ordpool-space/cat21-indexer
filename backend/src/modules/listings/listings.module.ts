import { Module } from '@nestjs/common';

import { DrizzleModule } from '../shared/drizzle/drizzle.module';
import { SyncModule } from '../sync/sync.module';
import { ListingsController } from './listings.controller';
import { ListingsPruner } from './listings.pruner';
import { ListingsService } from './listings.service';

@Module({
  imports: [DrizzleModule, SyncModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingsPruner],
  exports: [ListingsService],
})
export class ListingsModule {}
