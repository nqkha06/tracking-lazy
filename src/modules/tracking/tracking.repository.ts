import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccessLogDailyEntity } from '../../entities/access-log-daily.entity';
import { AccessLogEntity } from '../../entities/access-log.entity';
import { UserAgentEntity } from '../../entities/user-agent.entity';
import { detectBrowser, detectOs } from '../../utils/device.util';
import { toMysqlDateTime } from '../../utils/detection.util';
import {
  AccessLogQueuePayload,
  STATS_DATA_FIELD_VALUES,
  STATS_METRIC_FIELD_VALUES,
  StatsFilterCondition,
  StatsDataField,
  StatsGroupedRow,
  StatsMetricField,
  StatsOrderBy,
  StatsQueryFilterInput,
  StatsSummary,
} from './tracking.types';

@Injectable()
export class TrackingRepository {
  private readonly dataFieldSqlMap: Record<StatsDataField, string> = {
    created_at: 'logs.created_at',
    date: "DATE_FORMAT(logs.created_at, '%Y-%m-%d')",
    link_id: 'logs.link_id',
    user_id: 'logs.user_id',
    ip_address: 'logs.ip_address',
    country: 'logs.country',
    device: 'logs.device',
    is_earn: 'logs.is_earn',
    revenue: 'logs.revenue',
    detection_mask: 'logs.detection_mask',
    reject_reason_mask: 'logs.reject_reason_mask',
    'user_agents.browser': 'logs.browser',
    'user_agents.os': 'logs.os',
    'user_agents.raw': 'logs.raw',
  };

  private readonly metricSqlMap: Record<StatsMetricField, string> = {
    views: 'COUNT(*)',
    revenue: 'COALESCE(SUM(logs.revenue), 0)',
    earn_views:
      'COALESCE(SUM(CASE WHEN logs.is_earn = 1 THEN 1 ELSE 0 END), 0)',
    unique_users: 'COUNT(DISTINCT logs.user_id)',
    unique_ips: 'COUNT(DISTINCT logs.ip_address)',
  };

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

      await this.accessLogDailyRepository
        .createQueryBuilder()
        .insert()
        .into(AccessLogDailyEntity)
        .values(this.mapAccessLogValues(chunk))
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
        `SELECT id
         FROM ${dailyTable}
         WHERE created_at < ?
         ORDER BY id ASC
         LIMIT ?
         FOR UPDATE`,
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
        `DELETE FROM ${dailyTable}
         WHERE id IN (${placeholders})`,
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
    const datasetSql = this.buildStatsDatasetSql(params, filters);
    const whereClause = this.buildStatsWhereClause(filters, params);

    const rows = (await this.dataSource.query(
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

    const row = rows[0];

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

  async queryStatsRows(
    filters: StatsQueryFilterInput,
  ): Promise<StatsGroupedRow[]> {
    const params: Array<string | number> = [];
    const datasetSql = this.buildStatsDatasetSql(params, filters);
    const whereClause = this.buildStatsWhereClause(filters, params);
    const selectClause = this.buildStatsSelectClause(filters);
    const groupByClause = this.buildStatsGroupByClause(filters.groupFields);
    const orderByClause = this.buildStatsOrderByClause(
      filters.orderBy,
      filters.orderDirection,
      filters.aggregate,
    );

    params.push(filters.limit, filters.offset);

    const rows = (await this.dataSource.query(
      `SELECT
        ${selectClause}
      FROM ${datasetSql}
      ${whereClause}
      ${groupByClause}
      ${orderByClause}
      LIMIT ? OFFSET ?`,
      params,
    )) as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapStatsRow(row));
  }

  async queryStatsTotalRows(filters: StatsQueryFilterInput): Promise<number> {
    const params: Array<string | number> = [];
    const datasetSql = this.buildStatsDatasetSql(params, filters);
    const whereClause = this.buildStatsWhereClause(filters, params);
    const groupByClause = this.buildStatsGroupByClause(filters.groupFields);

    if (!filters.aggregate) {
      const rows = (await this.dataSource.query(
        `SELECT COUNT(*) AS total_rows
        FROM ${datasetSql}
        ${whereClause}`,
        params,
      )) as Array<Record<string, unknown>>;

      return this.toNumber(rows[0]?.total_rows);
    }

    const rows = (await this.dataSource.query(
      `SELECT COUNT(*) AS total_rows
      FROM (
        SELECT 1
        FROM ${datasetSql}
        ${whereClause}
        ${groupByClause}
      ) grouped_rows`,
      params,
    )) as Array<Record<string, unknown>>;

    return this.toNumber(rows[0]?.total_rows);
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

  private mapStatsRow(row: Record<string, unknown>): StatsGroupedRow {
    const mapped: StatsGroupedRow = {};

    for (const [key, rawValue] of Object.entries(row)) {
      if (rawValue === null || rawValue === undefined) {
        mapped[key] = null;
        continue;
      }

      if (typeof rawValue === 'number') {
        mapped[key] = this.formatNumericValue(key, rawValue);
        continue;
      }

      if (rawValue instanceof Date) {
        mapped[key] = toMysqlDateTime(rawValue);
        continue;
      }

      if (typeof rawValue === 'string') {
        const asNumber = Number(rawValue);
        mapped[key] = Number.isFinite(asNumber)
          ? this.formatNumericValue(key, asNumber)
          : rawValue;
        continue;
      }

      mapped[key] = String(rawValue);
    }

    return mapped;
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
    params: Array<string | number>,
    filters: StatsQueryFilterInput,
  ): string {
    const mainTable = this.quoteTableName(
      this.accessLogRepository.metadata.tableName,
    );
    const dailyTable = this.quoteTableName(
      this.accessLogDailyRepository.metadata.tableName,
    );
    const userAgentTable = this.quoteTableName(
      this.userAgentRepository.metadata.tableName,
    );

    params.push(
      filters.startAt,
      filters.endExclusive,
      filters.startAt,
      filters.endExclusive,
    );

    return `(
      SELECT
        logs.link_id,
        logs.user_id,
        logs.ip_address,
        logs.country,
        logs.device,
        logs.is_earn,
        logs.revenue,
        logs.created_at,
        logs.detection_mask,
        logs.reject_reason_mask,
        COALESCE(ua.browser, 'Unknown') AS browser,
        COALESCE(ua.os, 'Unknown') AS os,
        COALESCE(ua.raw, 'Unknown') AS raw
      FROM ${mainTable} logs
      LEFT JOIN ${userAgentTable} ua ON ua.hash = logs.agent_hash
      WHERE logs.created_at >= ? AND logs.created_at < ?

      UNION ALL

      SELECT
        logs.link_id,
        logs.user_id,
        logs.ip_address,
        logs.country,
        logs.device,
        logs.is_earn,
        logs.revenue,
        logs.created_at,
        logs.detection_mask,
        logs.reject_reason_mask,
        COALESCE(ua.browser, 'Unknown') AS browser,
        COALESCE(ua.os, 'Unknown') AS os,
        COALESCE(ua.raw, 'Unknown') AS raw
      FROM ${dailyTable} logs
      LEFT JOIN ${userAgentTable} ua ON ua.hash = logs.agent_hash
      WHERE logs.created_at >= ? AND logs.created_at < ?
    ) logs`;
  }

  private buildStatsWhereClause(
    filters: StatsQueryFilterInput,
    params: Array<string | number>,
  ): string {
    const conditions: string[] = [];

    for (const condition of filters.conditions) {
      this.appendCustomCondition(condition, conditions, params);
    }

    if (!conditions.length) {
      return '';
    }

    return `WHERE ${conditions.join(' AND ')}`;
  }

  private appendCustomCondition(
    condition: StatsFilterCondition,
    conditions: string[],
    params: Array<string | number>,
  ): void {
    const sqlField = this.dataFieldSqlMap[condition.field];

    if (condition.operator === 'IN' || condition.operator === 'NOT IN') {
      const values = Array.isArray(condition.value)
        ? condition.value
        : [condition.value];

      if (!values.length) {
        return;
      }

      const placeholders = values.map(() => '?').join(', ');
      conditions.push(`${sqlField} ${condition.operator} (${placeholders})`);
      params.push(...values);
      return;
    }

    if (
      condition.operator === 'BETWEEN' ||
      condition.operator === 'NOT BETWEEN'
    ) {
      const values = Array.isArray(condition.value)
        ? condition.value
        : [condition.value];

      if (values.length !== 2) {
        return;
      }

      conditions.push(`${sqlField} ${condition.operator} ? AND ?`);
      params.push(values[0] as string | number, values[1] as string | number);
      return;
    }

    conditions.push(`${sqlField} ${condition.operator} ?`);
    params.push(condition.value as string | number);
  }

  private buildStatsSelectClause(filters: StatsQueryFilterInput): string {
    const parts: string[] = [];

    for (const field of filters.selectFields) {
      if (this.isMetricField(field)) {
        if (!filters.aggregate && field === 'revenue') {
          parts.push(`${this.dataFieldSqlMap.revenue} AS \`${field}\``);
          continue;
        }

        parts.push(`${this.metricSqlMap[field]} AS \`${field}\``);
        continue;
      }

      if (this.isDataField(field)) {
        parts.push(`${this.dataFieldSqlMap[field]} AS \`${field}\``);
        continue;
      }
    }

    if (!parts.length) {
      return `${this.metricSqlMap.views} AS \`views\``;
    }

    return parts.join(', ');
  }

  private buildStatsGroupByClause(groupFields: StatsDataField[]): string {
    if (!groupFields.length) {
      return '';
    }

    const expressions = groupFields.map((field) => this.dataFieldSqlMap[field]);
    return `GROUP BY ${expressions.join(', ')}`;
  }

  private buildStatsOrderByClause(
    orderBy: StatsOrderBy,
    orderDirection: 'asc' | 'desc',
    aggregate: boolean,
  ): string {
    const direction = orderDirection.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const target =
      !aggregate && orderBy === 'revenue'
        ? this.dataFieldSqlMap.revenue
        : this.isMetricField(orderBy)
          ? this.metricSqlMap[orderBy]
          : this.dataFieldSqlMap[orderBy];

    return `ORDER BY ${target} ${direction}`;
  }

  private isDataField(value: string): value is StatsDataField {
    return STATS_DATA_FIELD_VALUES.includes(value as StatsDataField);
  }

  private isMetricField(value: string): value is StatsMetricField {
    return STATS_METRIC_FIELD_VALUES.includes(value as StatsMetricField);
  }

  private formatNumericValue(key: string, value: number): number {
    if (this.isMetricField(key) && ['revenue'].includes(key)) {
      return Number(value.toFixed(6));
    }

    if (this.isDataField(key) && key === 'revenue') {
      return Number(value.toFixed(6));
    }

    return value;
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
