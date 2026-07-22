import { Module } from '@nestjs/common';
import { CacheModule } from '../shared/cache/cache.module';
import { ElectrsClientService } from './electrs-client.service';
import { OrdClientService } from './ord-client.service';
import { SyncService } from './sync.service';

@Module({
  imports: [CacheModule],
  providers: [OrdClientService, ElectrsClientService, SyncService],
  exports: [OrdClientService, ElectrsClientService, SyncService],
})
export class SyncModule {}
