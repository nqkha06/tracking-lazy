import { DeviceKind } from '../../utils/device.util';

export interface LinkRate {
  mobile: number;
  desktop: number;
}

export interface LinkTier {
  id: number;
  bonus: number;
}

export interface LinkData {
  link_id: number;
  user_id: number;
  level_id: number;
  status: number;
  rate: LinkRate;
  tier: LinkTier;
}

export interface AccessLogQueuePayload {
  link_id: number;
  user_id: number;
  ip: string;
  agent_hash: string;
  country: string;
  device: number;
  revenue: number;
  is_earn: number;
  detection_mask: number;
  reject_reason_mask: number;
  created_at: string;
}

export const STATS_GROUP_BY_VALUES = [
  'date',
  'link',
  'user',
  'date_link',
  'date_user',
  'date_link_user',
  'link_user',
] as const;

export type StatsGroupBy = (typeof STATS_GROUP_BY_VALUES)[number];

export const STATS_DATA_FIELD_VALUES = [
  'created_at',
  'date',
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
  'user_agents.raw',
] as const;

export type StatsDataField = (typeof STATS_DATA_FIELD_VALUES)[number];

export const STATS_METRIC_FIELD_VALUES = [
  'views',
  'revenue',
  'earn_views',
  'unique_users',
  'unique_ips',
] as const;

export type StatsMetricField = (typeof STATS_METRIC_FIELD_VALUES)[number];

export type StatsSelectableField = StatsDataField | StatsMetricField;

export const STATS_FILTER_FIELD_VALUES = STATS_DATA_FIELD_VALUES;
export type StatsFilterField = StatsDataField;

export const STATS_FILTER_OPERATOR_VALUES = [
  '=',
  '!=',
  '<>',
  '>',
  '>=',
  '<',
  '<=',
  'LIKE',
  'NOT LIKE',
  'IN',
  'NOT IN',
  'BETWEEN',
  'NOT BETWEEN',
] as const;

export type StatsFilterOperator = (typeof STATS_FILTER_OPERATOR_VALUES)[number];

export type StatsFilterValue =
  | string
  | number
  | Array<string | number>
  | [string | number, string | number];

export interface StatsFilterCondition {
  field: StatsFilterField;
  operator: StatsFilterOperator;
  value: StatsFilterValue;
}

export const STATS_ORDER_DIRECTION_VALUES = ['asc', 'desc'] as const;
export type StatsOrderDirection = (typeof STATS_ORDER_DIRECTION_VALUES)[number];

export type StatsOrderBy = StatsSelectableField;

export interface StatsQueryFilterInput {
  startAt: string;
  endExclusive: string;
  selectFields: StatsSelectableField[];
  groupFields: StatsDataField[];
  aggregate: boolean;
  limit: number;
  offset: number;
  orderBy: StatsOrderBy;
  orderDirection: StatsOrderDirection;
  conditions: StatsFilterCondition[];
}

export interface StatsSummary {
  views: number;
  earnViews: number;
  revenue: number;
  uniqueLinks: number;
  uniqueUsers: number;
}

export type StatsGroupedRow = Record<string, string | number | null>;

export interface TrackResult {
  ok: boolean;
  code: string;
  linkId?: number;
  userId?: number;
  isEarn?: number;
  revenue?: number;
  isFake?: boolean;
  device?: DeviceKind;
}
