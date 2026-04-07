export const DETECTION_MASK = {
  AD_BLOCK: 1,
  PROXY_VPN: 2,
  IP_CHANGE: 4,
} as const;

export const REJECT_REASON_MASK = {
  LINK_NOT_FOUND: 1,
  LINK_INACTIVE: 2,
  FAKE_VIEW: 4,
  INVALID_ALIAS: 8,
} as const;

export interface DetectionInput {
  adBlock?: boolean;
  proxyVpn?: boolean;
  ipChange?: boolean;
}

const ALIAS_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;

export function isAliasValid(alias: string): boolean {
  return ALIAS_REGEX.test(alias);
}

export function sanitizeAlias(alias: string): string {
  return (alias || '').trim();
}

export function buildDetectionMask(input: DetectionInput): number {
  let mask = 0;

  if (input.adBlock) {
    mask |= DETECTION_MASK.AD_BLOCK;
  }

  if (input.proxyVpn) {
    mask |= DETECTION_MASK.PROXY_VPN;
  }

  if (input.ipChange) {
    mask |= DETECTION_MASK.IP_CHANGE;
  }

  return mask;
}

export function sanitizeCountry(country?: string): string {
  const value = (country || 'UNK').trim().toUpperCase();
  if (!/^[A-Z]{2,10}$/.test(value)) {
    return 'UNK';
  }

  return value;
}

export function formatVisitDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}${month}${day}`;
}

export function formatMinuteKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');

  return `${year}${month}${day}${hour}${minute}`;
}

export function toMysqlDateTime(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
