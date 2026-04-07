import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { type ChainableCommander } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST', '127.0.0.1'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      db: this.configService.get<number>('REDIS_DB', 0),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis error: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  createPipeline(): ChainableCommander {
    return this.client.pipeline();
  }

  async setNxWithExpiry(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async popBatchFromList(listKey: string, size: number): Promise<string[]> {
    const lua = `
      local items = redis.call('LRANGE', KEYS[1], 0, ARGV[1] - 1)
      if #items > 0 then
        redis.call('LTRIM', KEYS[1], ARGV[1], -1)
      end
      return items
    `;

    const result = await this.client.eval(lua, 1, listKey, size.toString());
    return Array.isArray(result) ? (result as string[]) : [];
  }

  async requeueToTail(listKey: string, values: string[]): Promise<void> {
    if (values.length === 0) {
      return;
    }

    await this.client.rpush(listKey, ...values);
  }

  async scanKeys(pattern: string, count = 500): Promise<string[]> {
    let cursor = '0';
    const keys: string[] = [];

    do {
      const [nextCursor, found] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        count,
      );
      cursor = nextCursor;
      keys.push(...found);
    } while (cursor !== '0');

    return keys;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async del(keys: string[]): Promise<number> {
    if (!keys.length) {
      return 0;
    }

    return this.client.del(...keys);
  }

  async acquireLock(
    key: string,
    token: string,
    ttlMs: number,
  ): Promise<boolean> {
    const result = await this.client.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const lua = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `;

    await this.client.eval(lua, 1, key, token);
  }
}
