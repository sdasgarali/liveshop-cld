import { Global, Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service';
import { RedisService } from './services/redis.service';
import { CacheService } from './services/cache.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, CacheService],
  exports: [PrismaService, RedisService, CacheService],
})
export class CommonModule {}
