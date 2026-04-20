import { Module } from '@nestjs/common';
import { CacheModule } from '../shared/cache/cache.module';
import { SyncModule } from '../sync/sync.module';
import { CatsController } from './cats.controller';
import { CatsService } from './cats.service';

@Module({
  imports: [CacheModule, SyncModule],
  controllers: [CatsController],
  providers: [CatsService],
})
export class CatsModule {}
