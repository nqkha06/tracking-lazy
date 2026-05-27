import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ChainableCommander } from 'ioredis';
import { HttpService } from '../../http/http.service';
import { RedisService } from '../../redis/redis.service';
import { DEVICE_CODE, detectDevice, sanitizeUserAgent } from '../../utils/device.util';
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
import {
  AccessLogQueuePayload,
  LinkData,
  LinkRateConfig,
  LinkRates,
  LinkTier,
  TrackResult,
} from './tracking.types';
import { TrackingRepository } from './tracking.repository';
import { NoteAccessLogEntity } from 'src/entities/note-access-log.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { NoteAccessQueryDto } from './dto/get-note-access-filter.dto';

import { BadRequestException } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';

@Injectable()
export class NoteAccessService {
  private readonly logger = new Logger(NoteAccessService.name);
  private readonly logsQueueKey: string;
  private readonly dedupeTtlSeconds: number;
  private readonly detailLinkEndpoint: string;
  private readonly linkDetailCacheTtlSeconds: number;
  private readonly cacheVersionKey: string;
  private readonly cacheVersionTtlMs: number;
  private cacheVersion = { value: '1', expiresAt: 0 };

  constructor(
    @InjectRepository(NoteAccessLogEntity)
    private readonly noteAcc: Repository<NoteAccessLogEntity>,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly redisService: RedisService,
    private readonly trackingRepository: TrackingRepository,
  ) {
    this.logsQueueKey = this.configService.get<string>('LOGS_QUEUE_KEY', 'logs_queue');
    this.dedupeTtlSeconds = this.configService.get<number>('VISIT_DEDUPE_TTL_SECONDS', 86400);
    this.detailLinkEndpoint = (
      this.configService.get<string>('DETAIL_LINK_ENDPOINT', '') || ''
    ).trim();
    this.linkDetailCacheTtlSeconds = this.configService.get<number>(
      'LINK_DETAIL_CACHE_TTL_SECONDS',
      60,
    );
    this.cacheVersionKey = this.configService.get<string>(
      'STU_CACHE_VERSION_KEY',
      'stu:cache:version',
    );
    const cacheVersionTtlSeconds = this.configService.get<number>(
      'STU_CACHE_VERSION_TTL_SECONDS',
      30,
    );
    this.cacheVersionTtlMs = Math.max(1, cacheVersionTtlSeconds) * 1000;
  }
  async findAll(query: NoteAccessQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.noteAcc.createQueryBuilder('note_access');

    this.applyFilters(qb, query);
    this.applyDateRange(qb, query);
    this.applySorting(qb, query);

    qb.skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  private applyFilters(
    qb: SelectQueryBuilder<NoteAccessLogEntity>,
    query: NoteAccessQueryDto,
  ): void {
    const filters = query.filters;

    if (!filters) {
      return;
    }

    if (filters.link_id !== undefined) {
      qb.andWhere('note_access.linkId = :linkId', {
        linkId: filters.link_id,
      });
    }

    if (filters.user_id !== undefined) {
      console.log('Applying filters:', filters.user_id);

      qb.andWhere('note_access.userId = :userId', {
        userId: filters.user_id,
      });
    }

    if (filters.country?.length) {
      qb.andWhere('country IN (:...countries)', {
        countries: filters.country,
      });
    }

    if (filters.device?.length) {
      qb.andWhere('device IN (:...devices)', {
        devices: filters.device,
      });
    }

    if (filters.is_earn !== undefined) {
      qb.andWhere('isEarn = :isEarn', {
        isEarn: filters.is_earn,
      });
    }

    if (filters.reject_reason_mask !== undefined) {
      qb.andWhere('rejectReasonMask = :rejectReasonMask', {
        rejectReasonMask: filters.reject_reason_mask,
      });
    }

    if (filters.ip_address) {
      qb.andWhere('ipAddress = :ipAddress', {
        ipAddress: filters.ip_address,
      });
    }
  }

  private applyDateRange(
    qb: SelectQueryBuilder<NoteAccessLogEntity>,
    query: NoteAccessQueryDto,
  ): void {
    const date = query.date;

    if (!date) {
      return;
    }

    if (date.from) {
      qb.andWhere('note_access.createdAt >= :from', {
        from: date.from,
      });
    }

    if (date.to) {
      qb.andWhere('note_access.createdAt <= :to', {
        to: date.to,
      });
    }
  }

  private applySorting(
    qb: SelectQueryBuilder<NoteAccessLogEntity>,
    query: NoteAccessQueryDto,
  ): void {
    const sort = query.sort;

    const sortMap: Record<string, string> = {
      id: 'note_access.id',
      revenue: 'note_access.revenue',
      created_at: 'note_access.createdAt',
    };

    if (!sort || Object.keys(sort).length === 0) {
      qb.orderBy('note_access.createdAt', 'DESC');
      return;
    }

    Object.entries(sort).forEach(([field, direction], index) => {
      const column = sortMap[field];

      if (!column) {
        throw new BadRequestException(`Invalid sort field: ${field}`);
      }

      const order = String(direction).toUpperCase();

      if (!['ASC', 'DESC'].includes(order)) {
        throw new BadRequestException(`Invalid sort direction: ${direction}`);
      }

      if (index === 0) {
        qb.orderBy(column, order as 'ASC' | 'DESC');
        return;
      }

      qb.addOrderBy(column, order as 'ASC' | 'DESC');
    });
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

    const link = await this.getLinkByAlias(cleanAlias, country);

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

    if (link.status.toLowerCase() !== 'active') {
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

    const rateConfig = this.resolveRateConfig(link.rates, country);
    const payout = device === 'mobile' ? rateConfig.payout.mobile : rateConfig.payout.desktop;
    let revenue = isFirstVisit ? payout / 1000 : 0;
    let isEarn = isFirstVisit ? 1 : 0;

    if (isFirstVisit) {
      try {
        const existedToday = await this.trackingRepository.existsTodayInDailyLogs(
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

    const fakePercent = 7 + link.tier.bonus_percent;
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
        // code: 'FAKE_VIEW_BYPASS',
        // linkId: link.link_id,
        // userId: link.user_id,
        // isEarn,
        // revenue,
        // isFake: true,
        // device,
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
    this.updateRealtimeStats(pipeline, minuteKey, link.link_id, link.user_id, revenue);
    pipeline.lpush(this.logsQueueKey, JSON.stringify(payload));
    await pipeline.exec();

    return {
      ok: true,
      // code: 'ACCEPTED',
      // linkId: link.link_id,
      // userId: link.user_id,
      // isEarn,
      // revenue,
      // isFake: false,
      // device,
    };
  }

  async getLinkByAlias(alias: string, country?: string): Promise<LinkData | null> {
    if (!this.detailLinkEndpoint) {
      this.logger.error('DETAIL_LINK_ENDPOINT is empty');
      return null;
    }

    const cacheKey = await this.buildLinkCacheKey(alias, country);
    try {
      const cached = await this.redisService.getClient().get(cacheKey);
      if (cached) {
        const cachedLink = this.parseLinkDetailPayload(JSON.parse(cached));
        if (cachedLink) {
          return cachedLink;
        }

        this.logger.warn(`Invalid cached link payload for alias ${alias}`);
        await this.redisService.getClient().del(cacheKey);
      }
    } catch (error) {
      this.logger.warn(`Failed reading link cache for alias ${alias}: ${(error as Error).message}`);
    }

    const requestUrl = this.buildDetailLinkUrl(alias);

    try {
      const response = await this.httpService.getWithRetry<unknown>(requestUrl);
      const link = this.parseLinkDetailPayload(response);

      if (!link) {
        this.logger.warn(`Invalid link detail payload for alias ${alias} from ${requestUrl}`);

        return null;
      }

      try {
        await this.redisService
          .getClient()
          .set(cacheKey, JSON.stringify(link), 'EX', this.linkDetailCacheTtlSeconds);
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
    await this.redisService.getClient().lpush(this.logsQueueKey, JSON.stringify(payload));
  }

  private async ensureUserAgentCached(
    hash: string,
    raw: string,
    deviceType: number,
  ): Promise<void> {
    try {
      const cacheKey = `ua:known:${hash}`;
      const isFirstSeen = await this.redisService.setNxWithExpiry(cacheKey, '1', 86400 * 30);

      if (!isFirstSeen) {
        return;
      }

      await this.trackingRepository.ensureUserAgent(hash, raw || 'unknown', deviceType);
    } catch (error) {
      this.logger.warn(`Unable to cache user-agent hash ${hash}: ${(error as Error).message}`);
    }
  }

  private sanitizeIp(ip: string): string {
    return '123.23.2.29';
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

  private async buildLinkCacheKey(alias: string, country?: string): Promise<string> {
    const version = await this.getCacheVersion();
    const normalizedCountry = sanitizeCountry(country || 'UNK');
    return `link:detail:v${version}:${sanitizeAlias(alias)}:${normalizedCountry}`;
  }

  private async getCacheVersion(): Promise<string> {
    const now = Date.now();
    if (now < this.cacheVersion.expiresAt) {
      return this.cacheVersion.value;
    }

    try {
      const raw = await this.redisService.getClient().get(this.cacheVersionKey);
      const version = raw && raw.trim().length > 0 ? raw.trim() : '1';
      this.cacheVersion = {
        value: version,
        expiresAt: now + this.cacheVersionTtlMs,
      };
      return version;
    } catch (error) {
      this.logger.warn(`Failed reading cache version: ${(error as Error).message}`);
      return this.cacheVersion.value || '1';
    }
  }

  private parseLinkDetailPayload(payload: unknown): LinkData | null {
    if (!this.isRecord(payload)) {
      return null;
    }

    const linkId = this.toNumber(payload.link_id);
    const userId = this.toNumber(payload.user_id);
    const levelId = this.toNumber(payload.level_id);
    const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '';
    const rates = this.parseLinkRates(payload.rates);
    const tier = this.parseLinkTier(payload.tier);

    if (linkId === null || userId === null || levelId === null || !status || !rates || !tier) {
      return null;
    }

    return {
      link_id: linkId,
      user_id: userId,
      level_id: levelId,
      status,
      rates,
      tier,
    };
  }

  private parseLinkRates(value: unknown): LinkRates | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const defaultRate = this.parseLinkRateConfig(value.default);
    if (!defaultRate) {
      return null;
    }

    const countriesNode = this.isRecord(value.countries) ? value.countries : {};
    const countries: Record<string, LinkRateConfig> = {};

    for (const [countryCode, config] of Object.entries(countriesNode)) {
      const parsed = this.parseLinkRateConfig(config);
      if (!parsed) {
        continue;
      }

      countries[sanitizeCountry(countryCode)] = parsed;
    }

    return {
      default: defaultRate,
      countries,
    };
  }

  private parseLinkRateConfig(value: unknown): LinkRateConfig | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const payout = this.parseRatePair(value.payout);
    const dailyLimit = this.parseRatePair(value.daily_limit);

    if (!payout || !dailyLimit) {
      return null;
    }

    return {
      payout,
      daily_limit: dailyLimit,
    };
  }

  private parseRatePair(value: unknown): { mobile: number; desktop: number } | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const mobile = this.toNumber(value.mobile);
    const desktop = this.toNumber(value.desktop);

    if (mobile === null || desktop === null) {
      return null;
    }

    return {
      mobile,
      desktop,
    };
  }

  private parseLinkTier(value: unknown): LinkTier | null {
    if (!this.isRecord(value)) {
      return null;
    }

    const level = this.toNumber(value.level);
    const bonusPercent = this.toNumber(value.bonus_percent);

    if (level === null || bonusPercent === null) {
      return null;
    }

    return {
      level,
      bonus_percent: bonusPercent,
    };
  }

  private resolveRateConfig(rates: LinkRates, country?: string): LinkRateConfig {
    const countryCode = sanitizeCountry(country || 'UNK');
    return rates.countries[countryCode] || rates.default;
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
