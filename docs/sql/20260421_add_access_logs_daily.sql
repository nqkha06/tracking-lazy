CREATE TABLE IF NOT EXISTS access_logs_daily (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  link_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  agent_hash CHAR(32) NOT NULL,
  country VARCHAR(10) NOT NULL DEFAULT 'UNK',
  device TINYINT UNSIGNED NOT NULL,
  revenue DECIMAL(10,6) NOT NULL DEFAULT 0,
  is_earn TINYINT UNSIGNED NOT NULL DEFAULT 0,
  detection_mask INT UNSIGNED NOT NULL DEFAULT 0,
  reject_reason_mask INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  INDEX idx_daily_link_ip_created_at (link_id, ip_address, created_at),
  INDEX idx_daily_created_at (created_at)
);
