import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '../../http/http.service';
import { RedisService } from '../../redis/redis.service';
import { DEVICE_CODE, detectDevice, sanitizeUserAgent } from '../../utils/device.util';
import {
  sanitizeAlias,
  sanitizeCountry,
} from '../../utils/detection.util';
import { md5 } from '../../utils/hash.util';
import {
  LinkData,
  LinkRateConfig,
  LinkRates,
  LinkTier,
  TrackResult,
} from './tracking.types';
import { NoteAccessLogEntity } from 'src/entities/note-access-log.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { StuAccessQueryDto } from './dto/get-stu-access-filter.dto';
import { TrackingRepository } from './tracking.repository';

import { BadRequestException } from '@nestjs/common';
import { SelectQueryBuilder } from 'typeorm';

@Injectable()
export class StuAccessService {
  private readonly logger = new Logger(StuAccessService.name);
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
  async findAll(query: StuAccessQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.noteAcc.createQueryBuilder('note_access');

    this.applyFilters(qb, query);
    this.applyDateRange(qb, query);
    const groupAliases = this.applyGroup(qb, query);
    if (groupAliases.length === 0) {
      this.applySelects(qb, query);
    }
    this.applySorting(qb, query, groupAliases);

    qb.skip(skip).take(limit);

    if (groupAliases.length > 0) {
      const countQuery = qb.clone();
      countQuery.skip(undefined).take(undefined);
      countQuery.orderBy();

      const total = (await countQuery.getRawMany()).length;
      const items = await qb.getRawMany();

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

  async createAsync(
    data: Omit<NoteAccessLogEntity, 'id'>,
    rawUserAgent: string,
  ): Promise<boolean> {
    const sanitizedUserAgent = sanitizeUserAgent(rawUserAgent || '');
    const agentHash = md5(sanitizedUserAgent || 'unknown');
    const device = detectDevice(sanitizedUserAgent);
    const deviceCode = DEVICE_CODE[device];

    await this.trackingRepository.ensureUserAgent(
      agentHash,
      sanitizedUserAgent || 'unknown',
      deviceCode,
    );

    const today = new Date().toISOString().slice(0, 10);

    const accessKey = `note_access:${data.ipAddress}:${data.userId}:${today}`;

    const isFirstAccess = await this.redisService.redis.set(
      accessKey,
      '1',
      'EX',
      86400, // 1 ngày
      'NX',
    );

    // đã access trước đó
    if (!isFirstAccess) {
      data.revenue = '0';
      data.isEarn = 0;
    } else {
      data.isEarn = 1;
    }
    await this.redisService.redis.lpush(
      'note_access_logs',
      JSON.stringify({ ...data, agentHash }),
    );

    return true;
  }
  private applyFilters(
    qb: SelectQueryBuilder<NoteAccessLogEntity>,
    query: StuAccessQueryDto,
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
      qb.andWhere('note_access.userId = :userId', {
        userId: filters.user_id,
      });
    }

    if (filters.country?.length) {
      qb.andWhere('note_access.country IN (:...countries)', {
        countries: filters.country,
      });
    }

    if (filters.device?.length) {
      qb.andWhere('note_access.device IN (:...devices)', {
        devices: filters.device,
      });
    }

    if (filters.is_earn !== undefined) {
      qb.andWhere('note_access.isEarn = :isEarn', {
        isEarn: filters.is_earn,
      });
    }

    if (filters.reject_reason_mask !== undefined) {
      qb.andWhere('note_access.rejectReasonMask = :rejectReasonMask', {
        rejectReasonMask: filters.reject_reason_mask,
      });
    }

    if (filters.ip_address) {
      qb.andWhere('note_access.ipAddress = :ipAddress', {
        ipAddress: filters.ip_address,
      });
    }
  }

  private applySelects(
    qb: SelectQueryBuilder<NoteAccessLogEntity>,
    query: StuAccessQueryDto,
  ): void {
    const selects = query.selects;

    if (!selects || selects.length === 0) {
      return;
    }

    const needsUserAgent = selects.some((field) => field.startsWith('user_agents.'));
    if (needsUserAgent) {
      qb.leftJoinAndSelect('note_access.userAgent', 'user_agent');
    }

    const selectMap: Record<string, string> = {
      id: 'note_access.id',
      link_id: 'note_access.linkId',
      user_id: 'note_access.userId',
      level_id: 'note_access.levelId',
      ip_address: 'note_access.ipAddress',
      agent_hash: 'note_access.agentHash',
      country: 'note_access.country',
      device: 'note_access.device',
      revenue: 'note_access.revenue',
      is_earn: 'note_access.isEarn',
      detection_mask: 'note_access.detectionMask',
      reject_reason_mask: 'note_access.rejectReasonMask',
      created_at: 'note_access.createdAt',
      'user_agents.hash': 'user_agent.hash',
      'user_agents.raw': 'user_agent.raw',
      'user_agents.browser': 'user_agent.browser',
      'user_agents.os': 'user_agent.os',
      'user_agents.device_type': 'user_agent.deviceType',
    };

    const columns = selects
      .map((field) => selectMap[field])
      .filter((column): column is string => Boolean(column));

    if (columns.length === 0) {
      return;
    }

    const sortMap: Record<string, string> = {
      id: 'note_access.id',
      revenue: 'note_access.revenue',
      created_at: 'note_access.createdAt',
    };

    const sort = query.sort;
    if (!sort || Object.keys(sort).length === 0) {
      if (!columns.includes(sortMap.created_at)) {
        columns.push(sortMap.created_at);
      }
    } else {
      Object.keys(sort).forEach((field) => {
        const orderColumn = sortMap[field];
        if (orderColumn && !columns.includes(orderColumn)) {
          columns.push(orderColumn);
        }
      });
    }

    if (!columns.includes('note_access.id')) {
      columns.unshift('note_access.id');
    }

    qb.select(columns);
  }

  private applyGroup(
    qb: SelectQueryBuilder<NoteAccessLogEntity>,
    query: StuAccessQueryDto,
  ): string[] {
    const groups = query.groups;

    if (!groups || groups.length === 0) {
      return [];
    }

    const groupMap: Record<string, { select: string; groupBy: string; alias: string }> = {
      date: {
        select: "DATE_FORMAT(note_access.createdAt, '%Y-%m-%d')",
        groupBy: "DATE_FORMAT(note_access.createdAt, '%Y-%m-%d')",
        alias: 'date',
      },
      level_id: {
        select: 'note_access.levelId',
        groupBy: 'note_access.levelId',
        alias: 'level_id',
      },
      link_id: {
        select: 'note_access.linkId',
        groupBy: 'note_access.linkId',
        alias: 'link_id',
      },
      user_id: {
        select: 'note_access.userId',
        groupBy: 'note_access.userId',
        alias: 'user_id',
      },

      country: {
        select: 'note_access.country',
        groupBy: 'note_access.country',
        alias: 'country',
      },
    };

    const groupFields = groups
      .map((field) => groupMap[field])
      .filter((field): field is { select: string; groupBy: string; alias: string } => Boolean(field));

    if (groupFields.length === 0) {
      return [];
    }

    const selectFields = groupFields.map((field) => `${field.select} AS ${field.alias}`);
    qb.select(selectFields);
    qb.addSelect('COUNT(*)', 'views');
    qb.addSelect('COALESCE(SUM(note_access.revenue), 0)', 'revenue');

    groupFields.forEach((field, index) => {
      if (index === 0) {
        qb.groupBy(field.groupBy);
        return;
      }

      qb.addGroupBy(field.groupBy);
    });

    return groupFields.map((field) => field.alias);
  }

  private applyDateRange(
    qb: SelectQueryBuilder<NoteAccessLogEntity>,
    query: StuAccessQueryDto,
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
    query: StuAccessQueryDto,
    groupAliases: string[],
  ): void {
    const sort = query.sort;

    const isGrouped = groupAliases.length > 0;
    const sortMap: Record<string, string> = isGrouped
      ? {
          date: 'date',
          level_id: 'level_id',
          link_id: 'link_id',
          user_id: 'user_id',
          revenue: 'revenue',
          views: 'views',
        }
      : {
          id: 'note_access.id',
          revenue: 'note_access.revenue',
          created_at: 'note_access.createdAt',
        };

    if (!sort || Object.keys(sort).length === 0) {
      if (isGrouped) {
        const defaultField = groupAliases[0];
        if (defaultField) {
          const direction = defaultField === 'date' ? 'DESC' : 'ASC';
          qb.orderBy(defaultField, direction);
          return;
        }
      }

      qb.orderBy('note_access.createdAt', 'DESC');
      return;
    }

    let sortIndex = 0;

    Object.entries(sort).forEach(([field, direction]) => {
      if (direction === undefined || direction === null || direction === '') {
        return;
      }

      const column = sortMap[field];

      if (!column) {
        throw new BadRequestException(`Invalid sort field: ${field}`);
      }

      const order = String(direction).toUpperCase();

      if (!['ASC', 'DESC'].includes(order)) {
        throw new BadRequestException(`Invalid sort direction: ${direction}`);
      }

      if (sortIndex === 0) {
        qb.orderBy(column, order as 'ASC' | 'DESC');
      } else {
        qb.addOrderBy(column, order as 'ASC' | 'DESC');
      }
      sortIndex += 1;
    });

    if (sortIndex === 0) {
      if (isGrouped) {
        const defaultField = groupAliases[0];
        if (defaultField) {
          const direction = defaultField === 'date' ? 'DESC' : 'ASC';
          qb.orderBy(defaultField, direction);
          return;
        }
      }

      qb.orderBy('note_access.createdAt', 'DESC');
    }
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
