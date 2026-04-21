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
  'day',
  'link',
  'user',
  'day_link',
  'day_user',
  'link_user',
  'day_link_user',
] as const;

export type StatsGroupBy = (typeof STATS_GROUP_BY_VALUES)[number];

export interface StatsQueryFilterInput {
  startAt: string;
  endExclusive: string;
  userId?: number;
  linkId?: number;
  country?: string;
  device?: number;
  isEarn?: 0 | 1;
  groupBy: StatsGroupBy;
  limit: number;
}

export interface StatsSummary {
  views: number;
  earnViews: number;
  revenue: number;
  uniqueLinks: number;
  uniqueUsers: number;
}

export interface StatsGroupedRow {
  day?: string;
  linkId?: number;
  userId?: number;
  views: number;
  earnViews: number;
  revenue: number;
}

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
