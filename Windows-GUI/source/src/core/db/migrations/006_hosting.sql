-- ============================================================================
-- 006_hosting.sql — 用户静态站点托管（根目录始终相对用户 storage）
-- ============================================================================

CREATE TABLE user_hosting (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  root_path    TEXT    NOT NULL DEFAULT '',
  enabled      INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  visibility   TEXT    NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  updated_at   INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_user_hosting_enabled ON user_hosting(enabled);
