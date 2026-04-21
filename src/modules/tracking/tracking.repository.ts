import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccessLogDailyEntity } from '../../entities/access-log-daily.entity';
import { AccessLogEntity } from '../../entities/access-log.entity';
import { UserAgentEntity } from '../../entities/user-agent.entity';
import { detectBrowser, detectOs } from '../../utils/device.util';
import {
  AccessLogQueuePayload,
  StatsGroupBy,
  StatsGroupedRow,
  StatsQueryFilterInput,
  StatsSummary,
} from './tracking.types';

@Injectable()
export class TrackingRepository {
  constructor(
    @InjectRepository(AccessLogEntity)
    private readonly accessLogRepository: Repository<AccessLogEntity>,
    @InjectRepository(AccessLogDailyEntity)
    private readonly accessLogDailyRepository: Repository<AccessLogDailyEntity>,
    @InjectRepository(UserAgentEntity)
    private readonly userAgentRepository: Repository<UserAgentEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async bulkInsertDailyAccessLogs(
    payloads: AccessLogQueuePayload[],
  ): Promise<void> {
    if (!payloads.length) {
      return;
    }

    const batchSize = 1000;
    for (let i = 0; i < payloads.length; i += batchSize) {
      const chunk = payloads.slice(i, i + batchSize);
      const values = this.mapAccessLogValues(chunk);

      await this.accessLogDailyRepository
        .createQueryBuilder()
        .insert()
        .into(AccessLogDailyEntity)
        .values(values)
        .execute();
    }
  }

  async existsTodayInDailyLogs(
    linkId: number,
    ipAddress: string,
    targetDate: Date,
  ): Promise<boolean> {
    const { start, end } = this.buildUtcDayRange(targetDate);

    const row = await this.accessLogDailyRepository
      .createQueryBuilder('daily')
      .select('daily.id', 'id')
      .where('daily.linkId = :linkId', { linkId })
      .andWhere('daily.ipAddress = :ipAddress', { ipAddress })
      .andWhere('daily.createdAt >= :start', { start })
      .andWhere('daily.createdAt < :end', { end })
      .limit(1)
      .getRawOne<{ id: string }>();

    return !!row;
  }

  async migrateDailyLogsToMain(
    beforeDate: Date,
    batchSize: number,
  ): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const mainTable = this.quoteTableName(
        this.accessLogRepository.metadata.tableName,
      );
      const dailyTable = this.quoteTableName(
        this.accessLogDailyRepository.metadata.tableName,
      );

      const rows = (await queryRunner.query(
        `SELECT id FROM ${dailyTable} WHERE created_at < ? ORDER BY id ASC LIMIT ? FOR UPDATE`,
        [beforeDate, batchSize],
      )) as Array<{ id: string | number }>;

      if (!rows.length) {
        await queryRunner.commitTransaction();
        return 0;
      }

      const ids = rows.map((row) => String(row.id));
      const placeholders = ids.map(() => '?').join(', ');

      await queryRunner.query(
        `INSERT INTO ${mainTable} (
          link_id,
          user_id,
          ip_address,
          agent_hash,
          country,
          device,
          revenue,
          is_earn,
          detection_mask,
          reject_reason_mask,
          created_at
        )
        SELECT
          link_id,
          user_id,
          ip_address,
          agent_hash,
          country,
          device,
          revenue,
          is_earn,
          detection_mask,
          reject_reason_mask,
          created_at
        FROM ${dailyTable}
        WHERE id IN (${placeholders})
        ORDER BY id ASC`,
        ids,
      );

      await queryRunner.query(
        `DELETE FROM ${dailyTable} WHERE id IN (${placeholders})`,
        ids,
      );

      await queryRunner.commitTransaction();
      return ids.length;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async queryStatsSummary(
    filters: StatsQueryFilterInput,
  ): Promise<StatsSummary> {
    const params: Array<string | number> = [];
    const datasetSql = this.buildStatsDatasetSql(filters, params);
    const whereClause = this.buildStatsWhereClause(filters, params);

    const summaryRows = (await this.dataSource.query(
      `SELECT
        COUNT(*) AS views,
        COALESCE(SUM(logs.revenue), 0) AS revenue,
        COALESCE(SUM(CASE WHEN logs.is_earn = 1 THEN 1 ELSE 0 END), 0) AS earn_views,
        COUNT(DISTINCT logs.link_id) AS unique_links,
        COUNT(DISTINCT logs.user_id) AS unique_users
      FROM ${datasetSql}
      ${whereClause}`,
      params,
    )) as Array<Record<string, unknown>>;

    const row = summaryRows[0];
    if (!row) {
      return {
        views: 0,
        earnViews: 0,
        revenue: 0,
        uniqueLinks: 0,
        uniqueUsers: 0,
      };
    }

    return {
      views: this.toNumber(row.views),
      earnViews: this.toNumber(row.earn_views),
      revenue: Number(this.toNumber(row.revenue).toFixed(6)),
      uniqueLinks: this.toNumber(row.unique_links),
      uniqueUsers: this.toNumber(row.unique_users),
    };
  }

  async queryStatsGrouped(
    filters: StatsQueryFilterInput,
  ): Promise<StatsGroupedRow[]> {
    const params: Array<string | number> = [];
    const datasetSql = this.buildStatsDatasetSql(filters, params);
    const whereClause = this.buildStatsWhereClause(filters, params);
    const groupByConfig = this.getStatsGroupConfig(filters.groupBy);
    const selectDimensions = groupByConfig.select.join(', ');
    const groupByClause = `GROUP BY ${groupByConfig.groupBy.join(', ')}`;
    const orderByClause = `ORDER BY ${groupByConfig.orderBy.join(', ')}`;
    params.push(filters.limit);

    const rows = (await this.dataSource.query(
      `SELECT
        ${selectDimensions},
        COUNT(*) AS views,
        COALESCE(SUM(logs.revenue), 0) AS revenue,
        COALESCE(SUM(CASE WHEN logs.is_earn = 1 THEN 1 ELSE 0 END), 0) AS earn_views
      FROM ${datasetSql}
      ${whereClause}
      ${groupByClause}
      ${orderByClause}
      LIMIT ?`,
      params,
    )) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const mappedRow: StatsGroupedRow = {
        views: this.toNumber(row.views),
        earnViews: this.toNumber(row.earn_views),
        revenue: Number(this.toNumber(row.revenue).toFixed(6)),
      };

      if (row.day !== undefined && row.day !== null) {
        mappedRow.day = String(row.day);
      }
      if (row.link_id !== undefined && row.link_id !== null) {
        mappedRow.linkId = this.toNumber(row.link_id);
      }
      if (row.user_id !== undefined && row.user_id !== null) {
        mappedRow.userId = this.toNumber(row.user_id);
      }

      return mappedRow;
    });
  }

  async ensureUserAgent(
    hash: string,
    raw: string,
    deviceType: number,
  ): Promise<void> {
    await this.userAgentRepository
      .createQueryBuilder()
      .insert()
      .into(UserAgentEntity)
      .values({
        hash,
        raw,
        browser: detectBrowser(raw),
        os: detectOs(raw),
        deviceType,
      })
      .orIgnore()
      .execute();
  }

  private mapAccessLogValues(payloads: AccessLogQueuePayload[]): Array<{
    linkId: number;
    userId: number;
    ipAddress: string;
    agentHash: string;
    country: string;
    device: number;
    revenue: string;
    isEarn: number;
    detectionMask: number;
    rejectReasonMask: number;
    createdAt: Date;
  }> {
    return payloads.map((payload) => ({
      linkId: payload.link_id,
      userId: payload.user_id,
      ipAddress: payload.ip,
      agentHash: payload.agent_hash,
      country: payload.country,
      device: payload.device,
      revenue: payload.revenue.toFixed(6),
      isEarn: payload.is_earn,
      detectionMask: payload.detection_mask,
      rejectReasonMask: payload.reject_reason_mask,
      createdAt: new Date(payload.created_at),
    }));
  }

  private buildUtcDayRange(targetDate: Date): { start: Date; end: Date } {
    const start = new Date(
      Date.UTC(
        targetDate.getUTCFullYear(),
        targetDate.getUTCMonth(),
        targetDate.getUTCDate(),
      ),
    );
    const end = new Date(start.getTime() + 86400 * 1000);
    return { start, end };
  }

  private quoteTableName(name: string): string {
    return `\`${name.replace(/`/g, '')}\``;
  }

  private buildStatsDatasetSql(
    filters: StatsQueryFilterInput,
    params: Array<string | number>,
  ): string {
    const mainTable = this.quoteTableName(
      this.accessLogRepository.metadata.tableName,
    );
    const dailyTable = this.quoteTableName(
      this.accessLogDailyRepository.metadata.tableName,
    );

    params.push(
      filters.startAt,
      filters.endExclusive,
      filters.startAt,
      filters.endExclusive,
    );

    return `(
      SELECT
        link_id,
        user_id,
        country,
        device,
        is_earn,
        revenue,
        created_at
      FROM ${mainTable}
      WHERE created_at >= ? AND created_at < ?
      UNION ALL
      SELECT
        link_id,
        user_id,
        country,
        device,
        is_earn,
        revenue,
        created_at
      FROM ${dailyTable}
      WHERE created_at >= ? AND created_at < ?
    ) logs`;
  }

  private buildStatsWhereClause(
    filters: StatsQueryFilterInput,
    params: Array<string | number>,
  ): string {
    const conditions: string[] = [];

    if (filters.userId !== undefined) {
      conditions.push('logs.user_id = ?');
      params.push(filters.userId);
    }

    if (filters.linkId !== undefined) {
      conditions.push('logs.link_id = ?');
      params.push(filters.linkId);
    }

    if (filters.country) {
      conditions.push('logs.country = ?');
      params.push(filters.country);
    }

    if (filters.device !== undefined) {
      conditions.push('logs.device = ?');
      params.push(filters.device);
    }

    if (filters.isEarn !== undefined) {
      conditions.push('logs.is_earn = ?');
      params.push(filters.isEarn);
    }

    if (!conditions.length) {
      return '';
    }

    return `WHERE ${conditions.join(' AND ')}`;
  }

  private getStatsGroupConfig(groupBy: StatsGroupBy): {
    select: string[];
    groupBy: string[];
    orderBy: string[];
  } {
    if (groupBy === 'day') {
      return {
        select: [`DATE_FORMAT(logs.created_at, '%Y-%m-%d') AS day`],
        groupBy: ['DATE(logs.created_at)'],
        orderBy: ['day ASC'],
      };
    }

    if (groupBy === 'link') {
      return {
        select: ['logs.link_id AS link_id'],
        groupBy: ['logs.link_id'],
        orderBy: ['link_id ASC'],
      };
    }

    if (groupBy === 'user') {
      return {
        select: ['logs.user_id AS user_id'],
        groupBy: ['logs.user_id'],
        orderBy: ['user_id ASC'],
      };
    }

    if (groupBy === 'day_link') {
      return {
        select: [
          `DATE_FORMAT(logs.created_at, '%Y-%m-%d') AS day`,
          'logs.link_id AS link_id',
        ],
        groupBy: ['DATE(logs.created_at)', 'logs.link_id'],
        orderBy: ['day ASC', 'link_id ASC'],
      };
    }

    if (groupBy === 'day_user') {
      return {
        select: [
          `DATE_FORMAT(logs.created_at, '%Y-%m-%d') AS day`,
          'logs.user_id AS user_id',
        ],
        groupBy: ['DATE(logs.created_at)', 'logs.user_id'],
        orderBy: ['day ASC', 'user_id ASC'],
      };
    }

    if (groupBy === 'link_user') {
      return {
        select: ['logs.link_id AS link_id', 'logs.user_id AS user_id'],
        groupBy: ['logs.link_id', 'logs.user_id'],
        orderBy: ['link_id ASC', 'user_id ASC'],
      };
    }

    return {
      select: [
        `DATE_FORMAT(logs.created_at, '%Y-%m-%d') AS day`,
        'logs.link_id AS link_id',
        'logs.user_id AS user_id',
      ],
      groupBy: ['DATE(logs.created_at)', 'logs.link_id', 'logs.user_id'],
      orderBy: ['day ASC', 'link_id ASC', 'user_id ASC'],
    };
  }

  private toNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return 0;
  }
}
