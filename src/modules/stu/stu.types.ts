export interface StuLevelRow {
  id: number;
  redirect_settings: unknown;
}

export interface StuLinkRow {
  id: number;
  alias: string;
  user_id: number;
  level_id: number;
  status: string | null;
  deleted_at: Date | string | null;
  level_redirect_settings: unknown;
  auto_level_id: string | number | null;
}

export interface StuLinkInfo {
  id: number;
  alias: string;
  userId: number;
  levelId: number;
  status: string | null;
  deletedAt: Date | string | null;
  redirectSettings: unknown;
}

export interface StuUserContext {
  os: string;
  device: string;
  browser: string;
  country: string;
  referer: string;
  referrer: string;
  ip_address: string;
  timestamp: number;
}

export interface StuRule {
  link?: unknown;
  priority?: unknown;
  conditions?: {
    include?: Record<string, unknown>;
    exclude?: Record<string, unknown>;
  };
}

export interface StuRedirectConfig {
  selection_strategy?: unknown;
  rules?: unknown;
}

export interface StuShowData {
  link: StuLinkInfo;
  redirectUrl: string | null;
  context: StuUserContext;
}
