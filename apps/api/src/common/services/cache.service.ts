import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTTL = 3600; // 1 hour

  constructor(private redisService: RedisService) {}

  private generateKey(prefix: string, identifier: string | number): string {
    return `cache:${prefix}:${identifier}`;
  }

  async get<T>(prefix: string, identifier: string | number): Promise<T | null> {
    try {
      const key = this.generateKey(prefix, identifier);
      const cached = await this.redisService.get(key);

      if (cached) {
        return JSON.parse(cached) as T;
      }

      return null;
    } catch (error) {
      this.logger.error(`Cache get error: ${error.message}`);
      return null;
    }
  }

  async set<T>(
    prefix: string,
    identifier: string | number,
    data: T,
    ttlSeconds: number = this.defaultTTL,
  ): Promise<void> {
    try {
      const key = this.generateKey(prefix, identifier);
      await this.redisService.set(key, JSON.stringify(data), ttlSeconds);
    } catch (error) {
      this.logger.error(`Cache set error: ${error.message}`);
    }
  }

  async invalidate(prefix: string, identifier: string | number): Promise<void> {
    try {
      const key = this.generateKey(prefix, identifier);
      await this.redisService.del(key);
    } catch (error) {
      this.logger.error(`Cache invalidate error: ${error.message}`);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redisService.keys(`cache:${pattern}:*`);
      for (const key of keys) {
        await this.redisService.del(key);
      }
    } catch (error) {
      this.logger.error(`Cache invalidatePattern error: ${error.message}`);
    }
  }

  async getOrSet<T>(
    prefix: string,
    identifier: string | number,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = this.defaultTTL,
  ): Promise<T> {
    const cached = await this.get<T>(prefix, identifier);

    if (cached !== null) {
      return cached;
    }

    const data = await fetchFn();
    await this.set(prefix, identifier, data, ttlSeconds);

    return data;
  }
}
