import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { HttpService } from '../../http/http.service';
import { RedisService } from '../../redis/redis.service';
import { formatMinuteKey } from '../../utils/detection.util';
import { TrackingRepository } from './tracking.repository';
import { AccessLogQueuePayload } from './tracking.types';

interface LaravelStatsPayload {
  links: Array<{ link_id: number; views: number; revenue: number }>;
  users: Array<{ user_id: number; revenue: number }>;
  minute_keys: string[];
  generated_at: string;
}

@Injectable()
export class TrackingWorker {
  private readonly logger = new Logger(TrackingWorker.name);
  private readonly logsQueueKey: string;
  private readonly statsSyncEndpoint: string;
  private readonly dailyMigrationBatchSize: number;
  private readonly dailyMigrationMaxBatches: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly trackingRepository: TrackingRepository,
    private readonly httpService: HttpService,
  ) {
    this.logsQueueKey = this.configService.get<string>(
      'LOGS_QUEUE_KEY',
      'logs_queue',
    );
    this.statsSyncEndpoint = this.configService.get<string>(
      'LARAVEL_STATS_ENDPOINT',
      'http://localhost:9999/internal/stats/update',
    );
    this.dailyMigrationBatchSize = this.configService.get<number>(
      'DAILY_MIGRATION_BATCH_SIZE',
      5000,
    );
    this.dailyMigrationMaxBatches = this.configService.get<number>(
      'DAILY_MIGRATION_MAX_BATCHES',
      20,
    );
  }

  @Interval(1500)
  async flushLogsToMysql(): Promise<void> {
    let rawLogs: string[] = [];

    try {
      rawLogs = await this.redisService.popBatchFromList(
        this.logsQueueKey,
        1000,
      );
      if (!rawLogs.length) {
        return;
      }

      const parsedLogs = this.deserializeLogs(rawLogs);
      if (!parsedLogs.length) {
        return;
      }

      await this.withRetry(
        () => this.trackingRepository.bulkInsertDailyAccessLogs(parsedLogs),
        3,
      );
    } catch (error) {
      if (this.isRedisClosedError(error)) {
        this.logger.warn(
          'Skip flushLogsToMysql tick: Redis connection is closed',
        );
        return;
      }

      this.logger.error(
        `Failed to insert daily log batch: ${(error as Error).message}`,
      );

      if (rawLogs.length) {
        try {
          await this.redisService.requeueToTail(this.logsQueueKey, rawLogs);
        } catch (requeueError) {
          this.logger.error(
            `Failed to return ${rawLogs.length} rows back to Redis queue: ${(requeueError as Error).message}`,
          );
        }
      }
    }
  }

  @Interval(60000)
  async migrateDailyLogsToMain(): Promise<void> {
    const lockKey = 'lock:access_logs_daily_migration';
    const lockToken = randomUUID();
    let lockAcquired = false;

    try {
      lockAcquired = await this.redisService.acquireLock(
        lockKey,
        lockToken,
        55_000,
      );

      if (!lockAcquired) {
        return;
      }

      const beforeDate = this.startOfUtcDay(new Date());
      let movedTotal = 0;

      for (let i = 0; i < this.dailyMigrationMaxBatches; i += 1) {
        const movedInBatch = await this.withRetry(
          () =>
            this.trackingRepository.migrateDailyLogsToMain(
              beforeDate,
              this.dailyMigrationBatchSize,
            ),
          3,
        );

        movedTotal += movedInBatch;
        if (movedInBatch < this.dailyMigrationBatchSize) {
          break;
        }
      }

      if (movedTotal > 0) {
        this.logger.log(
          `Migrated ${movedTotal} rows from access_logs_daily to access_logs`,
        );
      }
    } catch (error) {
      if (this.isRedisClosedError(error)) {
        this.logger.warn(
          'Skip migrateDailyLogsToMain tick: Redis connection is closed',
        );
        return;
      }

      this.logger.error(
        `Failed to migrate daily logs to main table: ${(error as Error).message}`,
      );
    } finally {
      if (lockAcquired) {
        try {
          await this.redisService.releaseLock(lockKey, lockToken);
        } catch (error) {
          if (!this.isRedisClosedError(error)) {
            this.logger.warn(
              `Failed to release migration lock: ${(error as Error).message}`,
            );
          }
        }
      }
    }
  }

  @Interval(60000)
  async aggregateAndSyncStats(): Promise<void> {
    const lockKey = 'lock:stats_aggregation';
    const lockToken = randomUUID();
    let lockAcquired = false;

    try {
      lockAcquired = await this.redisService.acquireLock(
        lockKey,
        lockToken,
        55_000,
      );

      if (!lockAcquired) {
        return;
      }

      const allKeys = await this.redisService.scanKeys('stat:minute:*');
      if (!allKeys.length) {
        return;
      }

      const currentMinuteKey = `stat:minute:${formatMinuteKey(new Date())}`;
      const targetKeys = allKeys.filter((key) => key !== currentMinuteKey);

      if (!targetKeys.length) {
        return;
      }

      const payload = await this.buildStatsPayload(targetKeys);
      if (!payload.links.length && !payload.users.length) {
        return;
      }

      await this.httpService.postWithRetry<LaravelStatsPayload, unknown>(
        this.statsSyncEndpoint,
        payload,
        3,
      );

      await this.redisService.del(targetKeys);
    } catch (error) {
      if (this.isRedisClosedError(error)) {
        this.logger.warn(
          'Skip aggregateAndSyncStats tick: Redis connection is closed',
        );
        return;
      }

      this.logger.error(
        `Failed to sync stats to Laravel endpoint ${this.statsSyncEndpoint}: ${(error as Error).message}`,
      );
    } finally {
      if (lockAcquired) {
        try {
          await this.redisService.releaseLock(lockKey, lockToken);
        } catch (error) {
          if (!this.isRedisClosedError(error)) {
            this.logger.warn(
              `Failed to release stats aggregation lock: ${(error as Error).message}`,
            );
          }
        }
      }
    }
  }

  private isRedisClosedError(error: unknown): boolean {
    return (error as Error)?.message?.toLowerCase().includes('connection is closed') ?? false;
  }

  private deserializeLogs(rawLogs: string[]): AccessLogQueuePayload[] {
    const parsed: AccessLogQueuePayload[] = [];

    for (const row of rawLogs) {
      try {
        const payload = JSON.parse(row) as AccessLogQueuePayload;
        if (payload && payload.ip && payload.agent_hash) {
          parsed.push(payload);
        }
      } catch (error) {
        this.logger.warn(
          `Skipping invalid queue payload: ${(error as Error).message}`,
        );
      }
    }

    return parsed;
  }

  private async buildStatsPayload(
    keys: string[],
  ): Promise<LaravelStatsPayload> {
    const pipeline = this.redisService.createPipeline();
    keys.forEach((key) => pipeline.hgetall(key));

    const result = await pipeline.exec();

    const linkViews = new Map<number, number>();
    const linkRevenue = new Map<number, number>();
    const userRevenue = new Map<number, number>();

    for (let i = 0; i < keys.length; i += 1) {
      const item = result?.[i];
      if (!item || item[0]) {
        continue;
      }

      const hash = item[1] as Record<string, string>;
      for (const [field, value] of Object.entries(hash)) {
        if (field.startsWith('link:') && field.endsWith(':views')) {
          const linkId = Number(field.split(':')[1]);
          const views = Number(value || 0);
          if (Number.isFinite(linkId) && Number.isFinite(views)) {
            linkViews.set(linkId, (linkViews.get(linkId) || 0) + views);
          }
          continue;
        }

        if (field.startsWith('link:') && field.endsWith(':revenue')) {
          const linkId = Number(field.split(':')[1]);
          const revenue = Number(value || 0);
          if (Number.isFinite(linkId) && Number.isFinite(revenue)) {
            linkRevenue.set(linkId, (linkRevenue.get(linkId) || 0) + revenue);
          }
          continue;
        }

        if (field.startsWith('user:') && field.endsWith(':revenue')) {
          const userId = Number(field.split(':')[1]);
          const revenue = Number(value || 0);
          if (Number.isFinite(userId) && Number.isFinite(revenue)) {
            userRevenue.set(userId, (userRevenue.get(userId) || 0) + revenue);
          }
        }
      }
    }

    return {
      links: Array.from(linkViews.entries()).map(([linkId, views]) => ({
        link_id: linkId,
        views,
        revenue: Number((linkRevenue.get(linkId) || 0).toFixed(6)),
      })),
      users: Array.from(userRevenue.entries()).map(([userId, revenue]) => ({
        user_id: userId,
        revenue: Number(revenue.toFixed(6)),
      })),
      minute_keys: keys.map((key) => key.replace('stat:minute:', '')),
      generated_at: new Date().toISOString(),
    };
  }

  private async withRetry<T>(
    callback: () => Promise<T>,
    maxRetries: number,
  ): Promise<T> {
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < maxRetries) {
      attempt += 1;
      try {
        return await callback();
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
      }
    }

    throw lastError ?? new Error('Unknown error during retry operation');
  }

  private startOfUtcDay(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
}
