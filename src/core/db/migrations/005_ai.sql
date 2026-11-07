-- ============================================================================
-- 005_ai.sql — 用户 AI 配置（API Key 仅存 AES-256-GCM 密文）
-- ============================================================================

CREATE TABLE user_ai_settings (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url      TEXT    NOT NULL DEFAULT '',
  model         TEXT    NOT NULL DEFAULT '',
  api_key_enc   TEXT    NOT NULL DEFAULT '',
  daily_limit   INTEGER NOT NULL DEFAULT 50 CHECK (daily_limit BETWEEN 1 AND 10000),
  work_scope    TEXT    NOT NULL DEFAULT 'folder' CHECK (work_scope IN ('folder', 'all')),
  work_dir      TEXT    NOT NULL DEFAULT '',
  used_date     TEXT    NOT NULL DEFAULT '',
  used_count    INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
) STRICT;
