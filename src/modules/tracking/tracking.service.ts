import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ChainableCommander } from 'ioredis';
import { HttpService } from '../../http/http.service';
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
  private readonly detailLinkEndpoint: string;
  private readonly linkDetailCacheTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
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
    this.detailLinkEndpoint = (
      this.configService.get<string>('DETAIL_LINK_ENDPOINT', '') || ''
    ).trim();
    this.linkDetailCacheTtlSeconds = this.configService.get<number>(
      'LINK_DETAIL_CACHE_TTL_SECONDS',
      60,
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

    const link = await this.getLinkByAlias(cleanAlias);

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

    if (link.status !== 1) {
      // link is not active
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

    if (isFirstVisit) {
      try {
        const existedToday =
          await this.trackingRepository.existsTodayInDailyLogs(
            link.link_id,
            normalizedIp,
            now,
          );

        if (existedToday) {
          revenue = 0;
          isEarn = 0;
        }
      } catch (error) {
        this.logger.warn(
          `Failed daily exists-check for link ${link.link_id}: ${(error as Error).message}`,
        );
      }
    }

    const fakePercent = 7 + link.tier.bonus;
    const roll = Math.floor(Math.random() * 10000) + 1;

    if (roll <= fakePercent * 100) {
      // treat as fake view
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

  async getLinkByAlias(alias: string): Promise<LinkData | null> {
    if (!this.detailLinkEndpoint) {
      this.logger.error('DETAIL_LINK_ENDPOINT is empty');
      return null;
    }

    const cacheKey = this.buildLinkCacheKey(alias);
    try {
      const cached = await this.redisService.getClient().get(cacheKey);
      if (cached) {
        const cachedLink = this.normalizeDetailPayload(JSON.parse(cached));
        if (cachedLink) {
          return cachedLink;
        }

        this.logger.warn(`Invalid cached link payload for alias ${alias}`);
        await this.redisService.getClient().del(cacheKey);
      }
    } catch (error) {
      this.logger.warn(
        `Failed reading link cache for alias ${alias}: ${(error as Error).message}`,
      );
    }

    const requestUrl = this.buildDetailLinkUrl(alias);

    try {
      const response = await this.httpService.getWithRetry<unknown>(requestUrl);
      const link = this.normalizeDetailPayload(response);

      if (!link) {
        this.logger.warn(
          `Invalid link detail payload for alias ${alias} from ${requestUrl}`,
        );

        return null;
      }

      try {
        await this.redisService
          .getClient()
          .set(
            cacheKey,
            JSON.stringify(link),
            'EX',
            this.linkDetailCacheTtlSeconds,
          );
      } catch (cacheError) {
        this.logger.warn(
          `Failed writing link cache for alias ${alias}: ${(cacheError as Error).message}`,
        );
      }

      return link;
    } catch (error) {
      this.logger.warn(
        `Failed to load link detail for alias ${alias}: ${(error as Error).message}`,
      );
      return null;
    }
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
    pipeline.hincrbyfloat(redisMinuteKey, `link:${linkId}:revenue`, revenue);
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

  private buildDetailLinkUrl(alias: string): string {
    const encodedAlias = encodeURIComponent(alias);
    return this.detailLinkEndpoint.replace(/\{alias\}/g, encodedAlias);
  }

  private buildLinkCacheKey(alias: string): string {
    return `link:detail:${sanitizeAlias(alias)}`;
  }

  private normalizeDetailPayload(payload: unknown): LinkData | null {
    const direct = this.normalizeLinkData(payload);
    if (direct) {
      return direct;
    }

    if (!this.isRecord(payload)) {
      return null;
    }

    const topLevelKeys = ['data', 'result', 'link', 'detail'];
    for (const key of topLevelKeys) {
      const nested = this.normalizeLinkData(payload[key]);
      if (nested) {
        return nested;
      }

      if (!this.isRecord(payload[key])) {
        continue;
      }

      for (const secondLevelKey of topLevelKeys) {
        const deepNested = this.normalizeLinkData(payload[key][secondLevelKey]);
        if (deepNested) {
          return deepNested;
        }
      }
    }

    return null;
  }

  private normalizeLinkData(value: unknown): LinkData | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const rate = value.rate;
    const tier = value.tier;
    if (!this.isRecord(rate) || !this.isRecord(tier)) {
      return null;
    }

    const linkId = this.toNumber(value.link_id);
    const userId = this.toNumber(value.user_id);
    const levelId = this.toNumber(value.level_id);
    const status = this.toNumber(value.status);
    const mobileRate = this.toNumber(rate.mobile);
    const desktopRate = this.toNumber(rate.desktop);
    const tierId = this.toNumber(tier.id);
    const tierBonus = this.toNumber(tier.bonus);

    if (
      linkId === null ||
      userId === null ||
      levelId === null ||
      status === null ||
      mobileRate === null ||
      desktopRate === null ||
      tierId === null ||
      tierBonus === null
    ) {
      return null;
    }

    return {
      link_id: linkId,
      user_id: userId,
      level_id: levelId,
      status,
      rate: {
        mobile: mobileRate,
        desktop: desktopRate,
      },
      tier: {
        id: tierId,
        bonus: tierBonus,
      },
    };
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const casted = Number(value);
      if (Number.isFinite(casted)) {
        return casted;
      }
    }

    return null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
