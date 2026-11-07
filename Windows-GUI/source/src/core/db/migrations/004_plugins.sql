-- ============================================================================
-- 004_plugins.sql — 插件安装状态（插件目录本身是代码/资源来源）
-- ============================================================================

CREATE TABLE plugins (
  name                TEXT    PRIMARY KEY,
  version             TEXT    NOT NULL,
  description         TEXT    NOT NULL DEFAULT '',
  enabled             INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  allow_web_override  INTEGER NOT NULL DEFAULT 0 CHECK (allow_web_override IN (0, 1)),
  installed_at        INTEGER NOT NULL,
  manifest_json       TEXT    NOT NULL
) STRICT;
