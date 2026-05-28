-- Seed/fix dataset for note_access_logs + note_access_logs_daily
-- Timezone: UTC

SET time_zone = '+00:00';

-- 1) Fix missing user_agents for existing logs (required for FK on agent_hash)
INSERT IGNORE INTO user_agents (hash, raw, browser, os, device_type)
SELECT DISTINCT agent_hash, 'Unknown', 'Unknown', 'Unknown', 2
FROM note_access_logs
WHERE agent_hash IS NOT NULL AND agent_hash <> '';

INSERT IGNORE INTO user_agents (hash, raw, browser, os, device_type)
SELECT DISTINCT agent_hash, 'Unknown', 'Unknown', 'Unknown', 2
FROM note_access_logs_daily
WHERE agent_hash IS NOT NULL AND agent_hash <> '';

-- 2) Idempotent cleanup for this seed's hashes
DELETE FROM note_access_logs WHERE agent_hash IN (
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'cccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddd'
);

DELETE FROM note_access_logs_daily WHERE agent_hash IN (
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'cccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddd'
);

DELETE FROM user_agents WHERE hash IN (
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'cccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddd'
);

-- 3) Seed user_agents used by note_access_logs
INSERT INTO user_agents (hash, raw, browser, os, device_type) VALUES
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36', 'Chrome', 'Windows', 2),
  ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'Safari', 'iOS', 1),
  ('cccccccccccccccccccccccccccccccc', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.6367.54 Mobile Safari/537.36', 'Chrome', 'Android', 1),
  ('dddddddddddddddddddddddddddddddd', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36', 'Chrome', 'Mac OS', 2);

-- 4) Historical data (already migrated): note_access_logs
INSERT INTO note_access_logs (
  link_id,
  user_id,
  level_id,
  ip_address,
  agent_hash,
  country,
  device,
  revenue,
  is_earn,
  detection_mask,
  reject_reason_mask,
  created_at
) VALUES
  (901, 3, 1, '10.20.0.1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'VN', 2, 0.001200, 1, 0, 0, '2026-05-20 08:10:00'),
  (901, 3, 1, '10.20.0.2', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'VN', 1, 0.000000, 0, 1, 0, '2026-05-20 08:22:00'),
  (902, 3, 2, '10.20.0.3', 'cccccccccccccccccccccccccccccccc', 'US', 2, 0.000900, 1, 0, 0, '2026-05-20 09:10:00'),
  (903, 7, 3, '10.20.0.4', 'dddddddddddddddddddddddddddddddd', 'IN', 1, 0.001500, 1, 0, 0, '2026-05-20 11:10:00');

-- 5) Current-day data (not yet migrated): note_access_logs_daily
INSERT INTO note_access_logs_daily (
  link_id,
  user_id,
  level_id,
  ip_address,
  agent_hash,
  country,
  device,
  revenue,
  is_earn,
  detection_mask,
  reject_reason_mask,
  created_at
) VALUES
  (901, 3, 1, '10.20.1.1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'VN', 2, 0.001180, 1, 0, 0, '2026-05-21 07:58:00'),
  (902, 3, 2, '10.20.1.2', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'VN', 1, 0.000000, 0, 1, 0, '2026-05-21 08:20:00'),
  (903, 7, 3, '10.20.1.3', 'cccccccccccccccccccccccccccccccc', 'US', 1, 0.000920, 1, 0, 0, '2026-05-21 09:06:00'),
  (903, 7, 3, '10.20.1.4', 'dddddddddddddddddddddddddddddddd', 'IN', 2, 0.000000, 0, 2, 0, '2026-05-21 09:42:00');

-- 6) Quick sanity checks
SELECT 'note_access_logs_count' AS metric, COUNT(*) AS value
FROM note_access_logs
WHERE agent_hash IN (
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'cccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddd'
)
UNION ALL
SELECT 'note_access_logs_daily_count' AS metric, COUNT(*) AS value
FROM note_access_logs_daily
WHERE agent_hash IN (
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'cccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddd'
)
UNION ALL
SELECT 'user_agents_count' AS metric, COUNT(*) AS value
FROM user_agents
WHERE hash IN (
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'cccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddd'
);
