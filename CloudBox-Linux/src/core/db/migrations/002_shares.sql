-- ============================================================================
-- 002_shares.sql — 带时效的公开分享直链
-- token 是随机高强度字符串；storage_key 做快照，避免用户目录变化后越权。
-- ============================================================================

CREATE TABLE shares (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT    NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,

  CONSTRAINT ck_shares_token_len   CHECK (length(token) BETWEEN 32 AND 128),
  CONSTRAINT ck_shares_path_len    CHECK (length(file_path) BETWEEN 1 AND 900),
  CONSTRAINT ck_shares_expiry      CHECK (expires_at > created_at)
) STRICT;

CREATE INDEX idx_shares_user    ON shares(user_id);
CREATE INDEX idx_shares_expires ON shares(expires_at);
