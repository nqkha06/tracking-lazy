import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ChainableCommander } from 'ioredis';
import { RedisService } from '../../redis/redis.service';
import {
  DEVICE_CODE,
  detectDevice,
  sanitizeUserAgent,
} from '../../utils/device.util';
import {
  buildDetectionMask,
  formatMinuteKey,
  formatVisitDateKey,
  isAliasValid,
  REJECT_REASON_MASK,
  sanitizeAlias,
  sanitizeCountry,
  toMysqlDateTime,
} from '../../utils/detection.util';
import { md5 } from '../../utils/hash.util';
import { TrackRequestDto } from './dto/track-request.dto';
import { AccessLogQueuePayload, LinkData, TrackResult } from './tracking.types';
import { TrackingRepository } from './tracking.repository';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);
  private readonly logsQueueKey: string;
  private readonly dedupeTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly trackingRepository: TrackingRepository,
  ) {
    this.logsQueueKey = this.configService.get<string>(
      'LOGS_QUEUE_KEY',
      'logs_queue',
    );
    this.dedupeTtlSeconds = this.configService.get<number>(
      'VISIT_DEDUPE_TTL_SECONDS',
      86400,
    );
  }

  async trackVisit(
    alias: string,
    body: TrackRequestDto,
    ipAddress: string,
    rawUserAgent: string,
  ): Promise<TrackResult> {
    const now = new Date();
    const cleanAlias = sanitizeAlias(alias);
    const normalizedIp = this.sanitizeIp(ipAddress);
    const userAgent = sanitizeUserAgent(rawUserAgent);
    const device = detectDevice(userAgent);
    const deviceCode = DEVICE_CODE[device];
    const country = sanitizeCountry(body.country);
    const detectionMask = buildDetectionMask(body);
    const agentHash = md5(userAgent || 'unknown');

    void this.ensureUserAgentCached(agentHash, userAgent, deviceCode);

    if (!isAliasValid(cleanAlias)) {
      // await this.enqueueLog({
      //   link_id: 0,
      //   user_id: 0,
      //   ip: normalizedIp,
      //   agent_hash: agentHash,
      //   country,
      //   device: deviceCode,
      //   revenue: 0,
      //   is_earn: 0,
      //   detection_mask: detectionMask,
      //   reject_reason_mask: REJECT_REASON_MASK.INVALID_ALIAS,
      //   created_at: toMysqlDateTime(now),
      // });

      return {
        ok: false,
        code: 'INVALID_ALIAS',
      };
    }

    const link = this.getLinkByAlias(cleanAlias);

    if (!link) {
      // await this.enqueueLog({
      //   link_id: 0,
      //   user_id: 0,
      //   ip: normalizedIp,
      //   agent_hash: agentHash,
      //   country,
      //   device: deviceCode,
      //   revenue: 0,
      //   is_earn: 0,
      //   detection_mask: detectionMask,
      //   reject_reason_mask: REJECT_REASON_MASK.LINK_NOT_FOUND,
      //   created_at: toMysqlDateTime(now),
      // });

      return {
        ok: false,
        code: 'LINK_NOT_FOUND',
      };
    }

    if (link.status !== 1) { // link is not active
      await this.enqueueLog({
        link_id: link.link_id,
        user_id: link.user_id,
        ip: normalizedIp,
        agent_hash: agentHash,
        country,
        device: deviceCode,
        revenue: 0,
        is_earn: 0,
        detection_mask: detectionMask,
        reject_reason_mask: REJECT_REASON_MASK.LINK_INACTIVE,
        created_at: toMysqlDateTime(now),
      });

      return {
        ok: false,
        code: 'LINK_INACTIVE',
        linkId: link.link_id,
        userId: link.user_id,
      };
    }

    const dedupeKey = `visit:${cleanAlias}:${normalizedIp}:${formatVisitDateKey(now)}`;
    const isFirstVisit = await this.redisService.setNxWithExpiry(
      dedupeKey,
      '1',
      this.dedupeTtlSeconds,
    );

    const rate = device === 'mobile' ? link.rate.mobile : link.rate.desktop;
    let revenue = isFirstVisit ? rate / 1000 : 0;
    let isEarn = isFirstVisit ? 1 : 0;

    const fakePercent = 7 + link.tier.bonus;
    const roll = Math.floor(Math.random() * 10000) + 1;

    if (roll <= fakePercent * 100) { // treat as fake view
      revenue = 0;
      isEarn = 0;

      await this.enqueueLog({
        link_id: link.link_id,
        user_id: link.user_id,
        ip: normalizedIp,
        agent_hash: agentHash,
        country,
        device: deviceCode,
        revenue,
        is_earn: isEarn,
        detection_mask: detectionMask,
        reject_reason_mask: REJECT_REASON_MASK.FAKE_VIEW,
        created_at: toMysqlDateTime(now),
      });

      return {
        ok: true,
        code: 'FAKE_VIEW_BYPASS',
        linkId: link.link_id,
        userId: link.user_id,
        isEarn,
        revenue,
        isFake: true,
        device,
      };
    }

    const minuteKey = formatMinuteKey(now);
    const payload: AccessLogQueuePayload = {
      link_id: link.link_id,
      user_id: link.user_id,
      ip: normalizedIp,
      agent_hash: agentHash,
      country,
      device: deviceCode,
      revenue,
      is_earn: isEarn,
      detection_mask: detectionMask,
      reject_reason_mask: 0,
      created_at: toMysqlDateTime(now),
    };

    const pipeline = this.redisService.createPipeline();
    this.updateRealtimeStats(
      pipeline,
      minuteKey,
      link.link_id,
      link.user_id,
      revenue,
    );
    pipeline.lpush(this.logsQueueKey, JSON.stringify(payload));
    await pipeline.exec();

    return {
      ok: true,
      code: 'ACCEPTED',
      linkId: link.link_id,
      userId: link.user_id,
      isEarn,
      revenue,
      isFake: false,
      device,
    };
  }

  getLinkByAlias(alias: string): LinkData | null {
    const mockRecord: Record<string, LinkData> = {
      demo: {
        link_id: 123,
        user_id: 456,
        level_id: 2,
        status: 1,
        rate: {
          mobile: 0.5,
          desktop: 1.2,
        },
        tier: {
          id: 2,
          bonus: 3,
        },
      },
      paused: {
        link_id: 124,
        user_id: 456,
        level_id: 2,
        status: 0,
        rate: {
          mobile: 0.5,
          desktop: 1.2,
        },
        tier: {
          id: 2,
          bonus: 3,
        },
      },
    };

    return mockRecord[alias] ?? null;
  }

  private updateRealtimeStats(
    pipeline: ChainableCommander,
    minuteKey: string,
    linkId: number,
    userId: number,
    revenue: number,
  ): void {
    const redisMinuteKey = `stat:minute:${minuteKey}`;
    pipeline.hincrby(redisMinuteKey, `link:${linkId}:views`, 1);
    pipeline.hincrbyfloat(redisMinuteKey, `user:${userId}:revenue`, revenue);
  }

  private async enqueueLog(payload: AccessLogQueuePayload): Promise<void> {
    await this.redisService
      .getClient()
      .lpush(this.logsQueueKey, JSON.stringify(payload));
  }

  private async ensureUserAgentCached(
    hash: string,
    raw: string,
    deviceType: number,
  ): Promise<void> {
    try {
      const cacheKey = `ua:known:${hash}`;
      const isFirstSeen = await this.redisService.setNxWithExpiry(
        cacheKey,
        '1',
        86400 * 30,
      );

      if (!isFirstSeen) {
        return;
      }

      await this.trackingRepository.ensureUserAgent(
        hash,
        raw || 'unknown',
        deviceType,
      );
    } catch (error) {
      this.logger.warn(
        `Unable to cache user-agent hash ${hash}: ${(error as Error).message}`,
      );
    }
  }

  private sanitizeIp(ip: string): string {
    const trimmed = (ip || '').trim();
    if (!trimmed) {
      return '0.0.0.0';
    }

    return trimmed.replace(/^::ffff:/, '').slice(0, 45);
  }
}
