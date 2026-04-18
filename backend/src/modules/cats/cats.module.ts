import { Module } from '@nestjs/common';
import { CacheModule } from '../shared/cache/cache.module';
import { CatsController } from './cats.controller';
import { CatsService } from './cats.service';

@Module({
  imports: [CacheModule],
  controllers: [CatsController],
  providers: [CatsService],
})
export class CatsModule {}
