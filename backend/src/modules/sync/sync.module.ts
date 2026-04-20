import { Module } from '@nestjs/common';
import { CacheModule } from '../shared/cache/cache.module';
import { OrdClientService } from './ord-client.service';
import { SyncService } from './sync.service';

@Module({
  imports: [CacheModule],
  providers: [OrdClientService, SyncService],
  exports: [OrdClientService, SyncService],
})
export class SyncModule {}
