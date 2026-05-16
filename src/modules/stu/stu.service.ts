import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { RedisService } from '../../redis/redis.service';
import { UaParserService } from '../../ua-parser/ua-parser.service';
import { isAliasValid, sanitizeAlias } from '../../utils/detection.util';
import { StuRepository } from './stu.repository';
import {
  StuLinkInfo,
  StuRedirectConfig,
  StuRule,
  StuShowData,
  StuUserContext,
} from './stu.types';

@Injectable()
export class StuService {
  private readonly logger = new Logger(StuService.name);
  private readonly cacheTtlSeconds: number;
  private readonly userContextTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly stuRepository: StuRepository,
    private readonly uaParserService: UaParserService,
  ) {
    this.cacheTtlSeconds = this.configService.get<number>(
      'STU_CACHE_TTL_SECONDS',
      3600,
    );
    this.userContextTtlSeconds = this.configService.get<number>(
      'STU_USER_CONTEXT_TTL_SECONDS',
      3600,
    );
  }

  async getShowData(
    alias: string,
    request: Request,
  ): Promise<StuShowData | null> {
    const cleanAlias = sanitizeAlias(alias);
    if (!isAliasValid(cleanAlias)) {
      return null;
    }

    const linkInfo = await this.getLinkWithAutoLevel(cleanAlias);
    if (!linkInfo || linkInfo.deletedAt !== null) {
      return null;
    }

    const ipAddress = this.extractClientIp(request);
    const userContext = this.buildUserContext(request, ipAddress);

    void this.cacheUserContext(cleanAlias, ipAddress, userContext);

    return {
      link: linkInfo,
      redirectUrl: this.determineRedirectUrl(linkInfo, userContext),
      context: userContext,
    };
  }

  buildUserContext(request: Request, ipAddress: string): StuUserContext {
    const rawUserAgent =
      request.header('user-agent') || request.header('xx-ua') || '';
    const parsed = this.uaParserService.parse(rawUserAgent);
    const language = this.extractPrimaryLanguage(request);
    const referrer =
      request.header('referer') || request.header('xx-referer') || 'direct';

    return {
      os: this.normalizeText(parsed?.os?.name, 'unknown'),
      device: this.resolveDevice(parsed?.device?.type),
      browser: this.normalizeText(parsed?.browser?.name, 'unknown'),
      country: this.resolveCountry(request, language),
      referer: referrer,
      referrer,
      ip_address: ipAddress,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  getMatchedRule(
    jsonConfig: StuRedirectConfig | null,
    userContext: StuUserContext,
  ): StuRule | null {
    if (!jsonConfig || !Array.isArray(jsonConfig.rules)) {
      return null;
    }

    const matchedRules: StuRule[] = [];

    for (const candidate of jsonConfig.rules) {
      if (!this.isRecord(candidate)) {
        continue;
      }

      const rule = candidate as StuRule;
      const conditions = this.isRecord(rule.conditions) ? rule.conditions : {};
      const exclude = this.isRecord(conditions.exclude)
        ? conditions.exclude
        : {};
      const include = this.isRecord(conditions.include)
        ? conditions.include
        : {};

      if (this.isMatched(userContext, exclude)) {
        continue;
      }

      if (
        Object.keys(include).length === 0 ||
        this.isMatched(userContext, include)
      ) {
        matchedRules.push(rule);
      }
    }

    if (matchedRules.length === 0) {
      return null;
    }

    const strategy =
      typeof jsonConfig.selection_strategy === 'string'
        ? jsonConfig.selection_strategy
        : 'priority';

    if (strategy === 'priority') {
      return matchedRules.sort(
        (a, b) => this.toNumber(b.priority) - this.toNumber(a.priority),
      )[0];
    }

    if (strategy === 'random') {
      return matchedRules[Math.floor(Math.random() * matchedRules.length)];
    }

    return matchedRules[0];
  }

  private async getLinkWithAutoLevel(
    alias: string,
  ): Promise<StuLinkInfo | null> {
    const cached = await this.getCachedLink(alias);
    if (cached) {
      return cached;
    }

    const row = await this.stuRepository.findLinkByAlias(alias);
    if (!row) {
      await this.redisService.getClient().del(this.linkCacheKey(alias));
      return null;
    }

    let levelId = Number(row.level_id || 0);
    let redirectSettings = row.level_redirect_settings;
    const autoLevelId = Number(row.auto_level_id || 0);

    if (autoLevelId > 0 && autoLevelId !== levelId) {
      const autoLevel = await this.findLevelCached(autoLevelId);
      if (autoLevel) {
        levelId = Number(autoLevel.id);
        redirectSettings = autoLevel.redirect_settings;
      }
    }

    const linkInfo: StuLinkInfo = {
      id: Number(row.id),
      alias: row.alias,
      userId: Number(row.user_id || 0),
      levelId,
      status: row.status,
      deletedAt: row.deleted_at,
      redirectSettings,
    };

    await this.setCachedJson(this.linkCacheKey(alias), linkInfo);
    return linkInfo;
  }

  private async findLevelCached(
    levelId: number,
  ): Promise<{ id: number; redirect_settings: unknown } | null> {
    const cacheKey = this.levelCacheKey(levelId);
    const cached = await this.getCachedJson<{
      id: number;
      redirect_settings: unknown;
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    const level = await this.stuRepository.findLevelById(levelId);
    if (!level) {
      return null;
    }

    await this.setCachedJson(cacheKey, level);
    return level;
  }

  private determineRedirectUrl(
    linkInfo: StuLinkInfo,
    userContext: StuUserContext,
  ): string | null {
    const config = this.parseRedirectConfig(linkInfo.redirectSettings);
    const rule = this.getMatchedRule(config, userContext);
    const link = typeof rule?.link === 'string' ? rule.link.trim() : '';
    console.log('Determining redirect URL with config:', {
      redirectSettings: config,
      parsedConfig: config,
      matchedRule: rule,
    });
    if (!link) {
      return null;
    }

    return this.appendAliasParam(link, linkInfo.alias);
  }

  private parseRedirectConfig(value: unknown): StuRedirectConfig | null {
    if (this.isRecord(value)) {
      return value as StuRedirectConfig;
    }

    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return this.isRecord(parsed) ? (parsed as StuRedirectConfig) : null;
    } catch (error) {
      this.logger.warn(
        `Invalid STU redirect_settings JSON: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private isMatched(
    userContext: StuUserContext,
    conditionGroup: Record<string, unknown>,
  ): boolean {
    let hasActualCondition = false;

    for (const [key, allowedValues] of Object.entries(conditionGroup)) {
      if (this.isEmptyCondition(allowedValues)) {
        continue;
      }

      hasActualCondition = true;
      const userValue = this.unknownToString(
        (userContext as unknown as Record<string, unknown>)[key],
      ).toLowerCase();

      if (Array.isArray(allowedValues)) {
        const normalizedAllowed = allowedValues.map((value) =>
          this.unknownToString(value).toLowerCase(),
        );
        if (!normalizedAllowed.includes(userValue)) {
          return false;
        }
        continue;
      }

      if (
        !userValue.includes(this.unknownToString(allowedValues).toLowerCase())
      ) {
        return false;
      }
    }

    return hasActualCondition;
  }

  private async cacheUserContext(
    alias: string,
    ipAddress: string,
    context: StuUserContext,
  ): Promise<void> {
    try {
      await this.redisService
        .getClient()
        .set(
          `agent:${alias}:${ipAddress}`,
          JSON.stringify(context),
          'EX',
          this.userContextTtlSeconds,
        );
    } catch (error) {
      this.logger.warn(
        `Failed to cache STU user context: ${(error as Error).message}`,
      );
    }
  }

  private async getCachedLink(alias: string): Promise<StuLinkInfo | null> {
    return this.getCachedJson<StuLinkInfo>(this.linkCacheKey(alias));
  }

  private async getCachedJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redisService.getClient().get(key);
      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(
        `Invalid cache payload for ${key}: ${(error as Error).message}`,
      );
      await this.redisService.getClient().del(key);
      return null;
    }
  }

  private async setCachedJson(key: string, value: unknown): Promise<void> {
    try {
      await this.redisService
        .getClient()
        .set(key, JSON.stringify(value), 'EX', this.cacheTtlSeconds);
    } catch (error) {
      this.logger.warn(
        `Failed writing cache ${key}: ${(error as Error).message}`,
      );
    }
  }

  private extractClientIp(request: Request): string {
    const forwardedFor =
      request.header('xx-ip-address') || request.header('x-forwarded-for');
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
      const firstIp = forwardedFor.split(',')[0];
      return this.sanitizeIp(firstIp || '');
    }

    return this.sanitizeIp(request.ip || request.socket.remoteAddress || '');
  }

  private sanitizeIp(ip: string): string {
    const trimmed = (ip || '').trim();
    return (trimmed || '0.0.0.0').replace(/^::ffff:/, '').slice(0, 45);
  }

  private extractPrimaryLanguage(request: Request): string {
    const acceptLanguage = request.header('accept-language') || '';
    const primary = acceptLanguage.split(',')[0] || '';
    return primary.split(';')[0].trim();
  }

  private resolveCountry(request: Request, fallback: string): string {
    const country = request.header('cf-ipcountry') || fallback || 'XX';
    return country.trim() || 'XX';
  }

  private resolveDevice(deviceType: unknown): string {
    const normalized = this.normalizeText(deviceType, 'desktop');
    if (['mobile', 'tablet'].includes(normalized)) {
      return normalized;
    }

    return 'desktop';
  }

  private normalizeText(value: unknown, fallback: string): string {
    return (
      this.unknownToString(value || fallback)
        .trim()
        .toLowerCase() || fallback
    );
  }

  private appendAliasParam(link: string, alias: string): string {
    const separator = link.includes('?') ? '&' : '?';
    return `${link}${separator}alias=${encodeURIComponent(alias)}`;
  }

  private isEmptyCondition(value: unknown): boolean {
    if (value === null || value === undefined || value === '') {
      return true;
    }

    return Array.isArray(value) && value.length === 0;
  }

  private toNumber(value: unknown): number {
    const numberValue = Number(value || 0);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  private unknownToString(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return '';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private linkCacheKey(alias: string): string {
    return `stu:link:${alias}`;
  }

  private levelCacheKey(levelId: number): string {
    return `stu:level:${levelId}`;
  }
}
