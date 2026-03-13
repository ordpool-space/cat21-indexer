import { Module } from '@nestjs/common';
import { OrdClientService } from './ord-client.service';
import { SyncService } from './sync.service';

@Module({
  providers: [OrdClientService, SyncService],
  exports: [OrdClientService],
})
export class SyncModule {}
