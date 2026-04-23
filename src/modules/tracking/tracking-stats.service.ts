import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toMysqlDateTime } from '../../utils/detection.util';
import { StatsQueryDto } from './dto/stats-query.dto';
import { TrackingRepository } from './tracking.repository';
import {
  STATS_DATA_FIELD_VALUES,
  STATS_FILTER_OPERATOR_VALUES,
  STATS_METRIC_FIELD_VALUES,
  STATS_ORDER_DIRECTION_VALUES,
  StatsDataField,
  StatsFilterCondition,
  StatsFilterOperator,
  StatsFilterValue,
  StatsGroupedRow,
  StatsMetricField,
  StatsOrderBy,
  StatsOrderDirection,
  StatsQueryFilterInput,
  StatsSelectableField,
} from './tracking.types';

type StatsFieldType = 'date' | 'number' | 'string';

interface StatsFieldRule {
  type: StatsFieldType;
  filterable: boolean;
  selectable: boolean;
  groupable: boolean;
  relation?: string;
  aliases: string[];
}

interface StatsMetricRule {
  aliases: string[];
}

interface StatsRawCondition {
  field: string;
  operator: string;
  value: unknown;
}

interface StatsFieldConfig {
  date_fields: StatsDataField[];
  filterable_fields: StatsDataField[];
  selectable_fields: StatsSelectableField[];
  relation_fields: StatsDataField[];
}

interface StatsPaginationMeta {
  page: number;
  per_page: number;
  current_page_items: number;
  total_items: number;
  total_pages: number;
  has_next_page: boolean;
  has_prev_page: boolean;
}

interface StatsQueryMeta {
  timezone: 'UTC';
  mode: 'raw' | 'aggregate';
  query: {
    created_at_from: string;
    created_at_to: string;
    select: StatsSelectableField[];
    group_fields: StatsDataField[];
    order_by: StatsOrderBy;
    order_direction: StatsOrderDirection;
    limit: number;
    page: number;
    conditions: StatsFilterCondition[];
  };
  fields: StatsFieldConfig;
  totals: {
    row_count: number;
    total_row_count: number;
  };
  pagination: StatsPaginationMeta;
  generated_at: string;
}

export interface StatsQueryResponse {
  success: true;
  code: 'STATS_QUERY_OK';
  message: 'ok';
  generated_at: string;
  meta: StatsQueryMeta;
  data: {
    rows: StatsGroupedRow[];
  };
}

@Injectable()
export class TrackingStatsService {
  private readonly maxQueryDays: number;
  private readonly defaultLimit = 500;
  private readonly defaultPage = 1;
  private readonly defaultAggregateSelectFields: StatsSelectableField[] = [
    'views',
    'revenue',
    'earn_views',
  ];
  private readonly defaultRawSelectFields: StatsSelectableField[] = [
    'created_at',
    'link_id',
    'user_id',
    'ip_address',
    'country',
    'device',
    'is_earn',
    'revenue',
    'detection_mask',
    'reject_reason_mask',
    'user_agents.browser',
    'user_agents.os',
  ];

  // Metadata-driven stats fields: define once for validate/filter/select/group
  private readonly dataFieldRules: Record<StatsDataField, StatsFieldRule> = {
    created_at: {
      type: 'date',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['created_at', 'createdat'],
    },
    date: {
      type: 'date',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['date', 'created'],
    },
    link_id: {
      type: 'number',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['link_id', 'linkid', 'link'],
    },
    user_id: {
      type: 'number',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['user_id', 'userid', 'user'],
    },
    ip_address: {
      type: 'string',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['ip_address', 'ipaddress', 'ip'],
    },
    country: {
      type: 'string',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['country'],
    },
    device: {
      type: 'number',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['device'],
    },
    is_earn: {
      type: 'number',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['is_earn', 'isearn'],
    },
    revenue: {
      type: 'number',
      filterable: true,
      selectable: false,
      groupable: false,
      aliases: ['revenue'],
    },
    detection_mask: {
      type: 'number',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['detection_mask', 'detectionmask', 'detection'],
    },
    reject_reason_mask: {
      type: 'number',
      filterable: true,
      selectable: true,
      groupable: true,
      aliases: ['reject_reason_mask', 'rejectreasonmask', 'reject_reason'],
    },
    'user_agents.browser': {
      type: 'string',
      filterable: true,
      selectable: true,
      groupable: true,
      relation: 'user_agents',
      aliases: ['user_agents.browser'],
    },
    'user_agents.os': {
      type: 'string',
      filterable: true,
      selectable: true,
      groupable: true,
      relation: 'user_agents',
      aliases: ['user_agents.os'],
    },
    'user_agents.raw': {
      type: 'string',
      filterable: true,
      selectable: true,
      groupable: true,
      relation: 'user_agents',
      aliases: ['user_agents.raw'],
    },
  };

  private readonly metricFieldRules: Record<StatsMetricField, StatsMetricRule> =
    {
      views: { aliases: ['views', 'view'] },
      revenue: { aliases: ['revenue', 'sum_revenue'] },
      earn_views: { aliases: ['earn_views', 'earnviews'] },
      unique_users: { aliases: ['unique_users', 'uniqueusers'] },
      unique_ips: { aliases: ['unique_ips', 'uniqueips'] },
    };

  private readonly dateFields = new Set<StatsDataField>(
    STATS_DATA_FIELD_VALUES.filter(
      (field) => this.dataFieldRules[field].type === 'date',
    ),
  );

  private readonly filterableFields = new Set<StatsDataField>(
    STATS_DATA_FIELD_VALUES.filter(
      (field) => this.dataFieldRules[field].filterable,
    ),
  );

  private readonly selectableFields = new Set<StatsSelectableField>([
    ...STATS_DATA_FIELD_VALUES.filter(
      (field) => this.dataFieldRules[field].selectable,
    ),
    ...STATS_METRIC_FIELD_VALUES,
  ]);

  private readonly relationFields = new Set<StatsDataField>(
    STATS_DATA_FIELD_VALUES.filter(
      (field) => this.dataFieldRules[field].relation !== undefined,
    ),
  );

  private readonly selectableAliasMap = new Map<string, StatsSelectableField>();
  private readonly filterAliasMap = new Map<string, StatsDataField>();

  constructor(
    private readonly configService: ConfigService,
    private readonly trackingRepository: TrackingRepository,
  ) {
    this.maxQueryDays = this.configService.get<number>(
      'STATS_QUERY_MAX_DAYS',
      93,
    );

    this.buildAliasMaps();
  }

  async queryStats(query: StatsQueryDto): Promise<StatsQueryResponse> {
    const range = this.resolveCreatedRange(query);
    const groupFields = this.resolveRequestedGroupFields(query);
    const aggregate = groupFields.length > 0;
    const selectFields = this.resolveSelectFields(
      query.select,
      groupFields,
      aggregate,
    );
    this.assertSelectFieldsCompatibleWithMode(
      selectFields,
      groupFields,
      aggregate,
    );
    const limit = query.limit ?? this.defaultLimit;
    const page = query.page ?? this.defaultPage;
    const offset = (page - 1) * limit;
    const orderBy = this.resolveOrderBy(
      query.orderBy,
      selectFields,
      groupFields,
      aggregate,
    );
    const orderDirection = this.resolveOrderDirection(query.orderDirection);

    const rawConditions = [
      ...this.resolvePresetConditions(query),
      ...this.parseRawConditions(query.where),
      ...this.parseRawConditions(query.filters),
    ];
    const normalizedConditions = rawConditions.map((condition, index) =>
      this.normalizeCondition(condition, index),
    );

    const filters: StatsQueryFilterInput = {
      startAt: range.startAt,
      endExclusive: range.endExclusive,
      selectFields,
      groupFields,
      aggregate,
      limit,
      offset,
      orderBy,
      orderDirection,
      conditions: normalizedConditions,
    };

    const [rows, totalRows] = await Promise.all([
      this.trackingRepository.queryStatsRows(filters),
      this.trackingRepository.queryStatsTotalRows(filters),
    ]);
    const generatedAt = new Date().toISOString();
    const totalPages = totalRows > 0 ? Math.ceil(totalRows / limit) : 0;

    return {
      success: true,
      code: 'STATS_QUERY_OK',
      message: 'ok',
      generated_at: generatedAt,
      meta: {
        timezone: 'UTC',
        mode: aggregate ? 'aggregate' : 'raw',
        query: {
          created_at_from: range.createdFrom,
          created_at_to: range.createdTo,
          select: selectFields,
          group_fields: groupFields,
          order_by: orderBy,
          order_direction: orderDirection,
          limit,
          page,
          conditions: normalizedConditions,
        },
        fields: {
          date_fields: Array.from(this.dateFields),
          filterable_fields: Array.from(this.filterableFields),
          selectable_fields: Array.from(this.selectableFields),
          relation_fields: Array.from(this.relationFields),
        },
        totals: {
          row_count: rows.length,
          total_row_count: totalRows,
        },
        pagination: {
          page,
          per_page: limit,
          current_page_items: rows.length,
          total_items: totalRows,
          total_pages: totalPages,
          has_next_page: page < totalPages,
          has_prev_page: page > 1,
        },
        generated_at: generatedAt,
      },
      data: {
        rows,
      },
    };
  }

  private buildAliasMaps(): void {
    for (const field of STATS_DATA_FIELD_VALUES) {
      this.selectableAliasMap.set(field, field);
      this.filterAliasMap.set(field, field);

      for (const alias of this.dataFieldRules[field].aliases) {
        const key = this.normalizeToken(alias);
        this.filterAliasMap.set(key, field);

        if (this.dataFieldRules[field].selectable) {
          this.selectableAliasMap.set(key, field);
        }
      }
    }

    for (const metric of STATS_METRIC_FIELD_VALUES) {
      this.selectableAliasMap.set(metric, metric);

      for (const alias of this.metricFieldRules[metric].aliases) {
        this.selectableAliasMap.set(this.normalizeToken(alias), metric);
      }
    }
  }

  private resolveCreatedRange(query: StatsQueryDto): {
    startAt: string;
    endExclusive: string;
    createdFrom: string;
    createdTo: string;
  } {
    if (query.createdAtFrom && query.createdAtTo) {
      const fromParsed = this.parseTemporalInput(
        query.createdAtFrom,
        'createdAtFrom',
      );
      const toParsed = this.parseTemporalInput(
        query.createdAtTo,
        'createdAtTo',
      );

      if (fromParsed.date.getTime() > toParsed.date.getTime()) {
        throw new BadRequestException('createdAtFrom must be <= createdAtTo');
      }

      const endExclusive = new Date(
        toParsed.date.getTime() +
          (toParsed.precision === 'date' ? 86400000 : 1000),
      );

      this.validateRangeWindow(fromParsed.date, endExclusive);

      return {
        startAt: toMysqlDateTime(fromParsed.date),
        endExclusive: toMysqlDateTime(endExclusive),
        createdFrom: toMysqlDateTime(fromParsed.date),
        createdTo: toMysqlDateTime(new Date(endExclusive.getTime() - 1000)),
      };
    }

    throw new BadRequestException('Require created_at_from/created_at_to');
  }

  private validateRangeWindow(start: Date, endExclusive: Date): void {
    if (start.getTime() >= endExclusive.getTime()) {
      throw new BadRequestException('Invalid time range');
    }

    const days = Math.ceil(
      (endExclusive.getTime() - start.getTime()) / 86400000,
    );
    if (days > this.maxQueryDays) {
      throw new BadRequestException(
        `Date range too large. Max ${this.maxQueryDays} days`,
      );
    }
  }

  private resolveRequestedGroupFields(query: StatsQueryDto): StatsDataField[] {
    const requested = new Set<StatsDataField>();

    for (const token of query.groupFields || []) {
      requested.add(this.resolveGroupField(token, 'group_fields'));
    }

    for (const token of query.groups || []) {
      requested.add(this.resolveGroupField(token, 'groups'));
    }

    if (query.groupBy) {
      for (const mapped of this.mapLegacyGroupBy(query.groupBy)) {
        requested.add(mapped);
      }
    }

    return Array.from(requested);
  }

  private resolveGroupField(value: string, source: string): StatsDataField {
    const canonical = this.canonicalizeFilterField(value);
    if (!canonical) {
      throw new BadRequestException(
        `Unsupported ${source} field: ${value}. Allowed: ${Array.from(
          this.filterableFields,
        ).join(', ')}`,
      );
    }

    // group by created_at is normalized to date(created_at)
    if (canonical === 'created_at') {
      return 'date';
    }

    if (!this.dataFieldRules[canonical].groupable) {
      throw new BadRequestException(`Field ${canonical} is not groupable`);
    }

    return canonical;
  }

  private mapLegacyGroupBy(value: string): StatsDataField[] {
    switch (value) {
      case 'date':
        return ['date'];
      case 'link':
        return ['link_id'];
      case 'user':
        return ['user_id'];
      case 'date_link':
        return ['date', 'link_id'];
      case 'date_user':
        return ['date', 'user_id'];
      case 'link_user':
        return ['link_id', 'user_id'];
      case 'date_link_user':
      default:
        return ['date', 'link_id', 'user_id'];
    }
  }

  private resolveSelectFields(
    selectFromQuery: string[] | undefined,
    requestedGroups: StatsDataField[],
    aggregate: boolean,
  ): StatsSelectableField[] {
    const resolved: StatsSelectableField[] = [];
    const selectedRaw =
      selectFromQuery && selectFromQuery.length
        ? selectFromQuery
        : aggregate
          ? [...requestedGroups, ...this.defaultAggregateSelectFields]
          : [...this.defaultRawSelectFields];

    for (const token of selectedRaw) {
      const canonical = this.canonicalizeSelectableField(token);

      if (!canonical) {
        throw new BadRequestException(
          `Unsupported select field: ${token}. Allowed: ${Array.from(
            this.selectableFields,
          ).join(', ')}`,
        );
      }

      const normalizedCanonical =
        aggregate &&
        canonical === 'created_at' &&
        requestedGroups.includes('date')
          ? ('date' as StatsSelectableField)
          : canonical;

      if (aggregate && !this.selectableFields.has(normalizedCanonical)) {
        throw new BadRequestException(
          `Unsupported select field: ${token}. Allowed: ${Array.from(
            this.selectableFields,
          ).join(', ')}`,
        );
      }

      if (!aggregate && !this.isDataField(normalizedCanonical)) {
        throw new BadRequestException(
          `select field ${normalizedCanonical} is metric. Raw mode only supports data fields. Add group_fields to use metrics.`,
        );
      }

      if (!resolved.includes(normalizedCanonical)) {
        resolved.push(normalizedCanonical);
      }
    }

    if (!resolved.length) {
      return aggregate
        ? [...this.defaultAggregateSelectFields]
        : [...this.defaultRawSelectFields];
    }

    return resolved;
  }

  private assertSelectFieldsCompatibleWithMode(
    selectFields: StatsSelectableField[],
    groupFields: StatsDataField[],
    aggregate: boolean,
  ): void {
    if (!aggregate) {
      return;
    }

    for (const field of selectFields) {
      if (this.isMetricField(field)) {
        continue;
      }

      if (!this.isDataField(field)) {
        continue;
      }

      if (!groupFields.includes(field)) {
        throw new BadRequestException(
          `select field ${field} must appear in group_fields when aggregate mode is enabled`,
        );
      }
    }
  }

  private resolveOrderBy(
    orderByValue: string | undefined,
    selectFields: StatsSelectableField[],
    groupFields: StatsDataField[],
    aggregate: boolean,
  ): StatsOrderBy {
    if (orderByValue) {
      const canonical = this.canonicalizeSelectableField(orderByValue);

      if (!canonical || !this.selectableFields.has(canonical)) {
        throw new BadRequestException(
          `Unsupported order_by: ${orderByValue}. Allowed: ${Array.from(
            this.selectableFields,
          ).join(', ')}`,
        );
      }

      const normalizedCanonical =
        aggregate && canonical === 'created_at' && groupFields.includes('date')
          ? ('date' as StatsOrderBy)
          : canonical;

      if (!aggregate && !this.isDataField(normalizedCanonical)) {
        throw new BadRequestException(
          `order_by ${normalizedCanonical} is metric. Raw mode only supports data fields.`,
        );
      }

      if (
        aggregate &&
        !this.isMetricField(normalizedCanonical) &&
        this.isDataField(normalizedCanonical) &&
        !groupFields.includes(normalizedCanonical)
      ) {
        throw new BadRequestException(
          `order_by ${normalizedCanonical} must appear in group_fields in aggregate mode`,
        );
      }

      return normalizedCanonical;
    }

    if (!aggregate) {
      return 'created_at';
    }

    if (groupFields.includes('date')) {
      return 'date';
    }

    if (selectFields.includes('views')) {
      return 'views';
    }

    return selectFields[0] || 'views';
  }

  private resolveOrderDirection(value?: string): StatsOrderDirection {
    const normalized = String(value || 'asc')
      .trim()
      .toLowerCase();

    if (
      STATS_ORDER_DIRECTION_VALUES.includes(normalized as StatsOrderDirection)
    ) {
      return normalized as StatsOrderDirection;
    }

    return 'asc';
  }

  private resolvePresetConditions(query: StatsQueryDto): StatsRawCondition[] {
    const conditions: StatsRawCondition[] = [];

    if (query.userId !== undefined) {
      conditions.push({
        field: 'user_id',
        operator: '=',
        value: query.userId,
      });
    }

    if (query.linkId !== undefined) {
      conditions.push({
        field: 'link_id',
        operator: '=',
        value: query.linkId,
      });
    }

    if (query.country) {
      conditions.push({
        field: 'country',
        operator: '=',
        value: query.country.trim().toUpperCase(),
      });
    }

    if (query.device !== undefined) {
      conditions.push({
        field: 'device',
        operator: '=',
        value: query.device,
      });
    }

    if (query.isEarn !== undefined) {
      conditions.push({
        field: 'is_earn',
        operator: '=',
        value: query.isEarn,
      });
    }

    return conditions;
  }

  private parseRawConditions(raw?: string): StatsRawCondition[] {
    if (!raw) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('where/filters must be a valid JSON array');
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException('where/filters must be an array');
    }

    return parsed.map((item, index) => this.normalizeRawCondition(item, index));
  }

  private normalizeRawCondition(
    value: unknown,
    index: number,
  ): StatsRawCondition {
    if (Array.isArray(value)) {
      if (value.length < 3) {
        throw new BadRequestException(
          `where[${index}] must be [field, operator, value]`,
        );
      }

      return {
        field: String(value[0] || ''),
        operator: String(value[1] || ''),
        value: value[2],
      };
    }

    if (typeof value === 'object' && value !== null) {
      const row = value as Record<string, unknown>;
      const field = row.field ?? row.column;
      const operator = row.operator ?? row.op;

      return {
        field: String(field || ''),
        operator: String(operator || ''),
        value: row.value,
      };
    }

    throw new BadRequestException(
      `where[${index}] must be object or [field, operator, value]`,
    );
  }

  private normalizeCondition(
    condition: StatsRawCondition,
    index: number,
  ): StatsFilterCondition {
    const field = this.canonicalizeFilterField(condition.field);
    if (!field || !this.filterableFields.has(field)) {
      throw new BadRequestException(
        `where[${index}] unsupported field: ${condition.field}`,
      );
    }

    const operator = this.normalizeOperator(condition.operator, index);
    const value = this.normalizeConditionValue(
      field,
      operator,
      condition.value,
    );

    return {
      field,
      operator,
      value,
    };
  }

  private normalizeOperator(value: string, index: number): StatsFilterOperator {
    const normalized = value.trim().toUpperCase().replace(/\s+/g, ' ');
    const mapped =
      normalized === 'NOT_IN'
        ? 'NOT IN'
        : normalized === 'NOT_LIKE'
          ? 'NOT LIKE'
          : normalized;

    if (!STATS_FILTER_OPERATOR_VALUES.includes(mapped as StatsFilterOperator)) {
      throw new BadRequestException(
        `where[${index}] unsupported operator: ${value}`,
      );
    }

    return mapped as StatsFilterOperator;
  }

  private normalizeConditionValue(
    field: StatsDataField,
    operator: StatsFilterOperator,
    value: unknown,
  ): StatsFilterValue {
    if (operator === 'IN' || operator === 'NOT IN') {
      const list = this.toArrayValue(value);
      if (!list.length) {
        throw new BadRequestException(`${operator} requires non-empty array`);
      }

      return list.map((item) => this.normalizeScalarValue(field, item));
    }

    if (operator === 'BETWEEN' || operator === 'NOT BETWEEN') {
      const list = this.toArrayValue(value);
      if (list.length !== 2) {
        throw new BadRequestException(`${operator} requires exactly 2 values`);
      }

      return [
        this.normalizeScalarValue(field, list[0]),
        this.normalizeScalarValue(field, list[1]),
      ];
    }

    return this.normalizeScalarValue(field, value);
  }

  private toArrayValue(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }

    const raw = String(value ?? '').trim();
    if (!raw) {
      return [];
    }

    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private normalizeScalarValue(
    field: StatsDataField,
    value: unknown,
  ): string | number {
    const type = this.dataFieldRules[field].type;

    if (type === 'number') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new BadRequestException(
          `Filter value for ${field} must be numeric`,
        );
      }

      return parsed;
    }

    if (type === 'date') {
      if (field === 'date') {
        return toMysqlDateTime(
          this.parseDateOnlyUtc(String(value), field),
        ).slice(0, 10);
      }

      return toMysqlDateTime(
        this.parseTemporalInput(String(value), field).date,
      );
    }

    return String(value ?? '').trim();
  }

  private canonicalizeSelectableField(
    value: string,
  ): StatsSelectableField | null {
    const token = this.normalizeToken(value);
    return this.selectableAliasMap.get(token) || null;
  }

  private canonicalizeFilterField(value: string): StatsDataField | null {
    const token = this.normalizeToken(value);
    return this.filterAliasMap.get(token) || null;
  }

  private normalizeToken(value: string): string {
    return value.trim().toLowerCase();
  }

  private isDataField(field: StatsSelectableField): field is StatsDataField {
    return STATS_DATA_FIELD_VALUES.includes(field as StatsDataField);
  }

  private isMetricField(
    field: StatsSelectableField,
  ): field is StatsMetricField {
    return STATS_METRIC_FIELD_VALUES.includes(field as StatsMetricField);
  }

  private parseDateOnlyUtc(value: string, fieldName: string): Date {
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!matched) {
      throw new BadRequestException(`${fieldName} must be YYYY-MM-DD`);
    }

    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const day = Number(matched[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new BadRequestException(`${fieldName} is not a valid date`);
    }

    return parsed;
  }

  private parseTemporalInput(
    value: string,
    fieldName: string,
  ): { date: Date; precision: 'date' | 'datetime' } {
    const trimmed = value.trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnly) {
      return {
        date: this.parseDateOnlyUtc(trimmed, fieldName),
        precision: 'date',
      };
    }

    const dateTime =
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(trimmed);
    if (!dateTime) {
      throw new BadRequestException(
        `${fieldName} must be YYYY-MM-DD or YYYY-MM-DD HH:mm:ss`,
      );
    }

    const year = Number(dateTime[1]);
    const month = Number(dateTime[2]);
    const day = Number(dateTime[3]);
    const hour = Number(dateTime[4]);
    const minute = Number(dateTime[5]);
    const second = Number(dateTime[6]);
    const parsed = new Date(
      Date.UTC(year, month - 1, day, hour, minute, second),
    );

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day ||
      parsed.getUTCHours() !== hour ||
      parsed.getUTCMinutes() !== minute ||
      parsed.getUTCSeconds() !== second
    ) {
      throw new BadRequestException(`${fieldName} is not a valid datetime`);
    }

    return {
      date: parsed,
      precision: 'datetime',
    };
  }
}
