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
