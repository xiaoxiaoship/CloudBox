-- ============================================================================
-- 001_init.sql — CloudBox 初始架构
-- 约定：
--   * 所有时间戳为 Unix 毫秒（INTEGER）
--   * 所有业务表使用 STRICT 模式，禁止隐式类型转换
--   * 枚举使用 CHECK 约束；外键默认 ON DELETE CASCADE
-- ============================================================================

-- 账户（管理员与普通用户同表，用 role 区分；单管理员由部分唯一索引强制）
CREATE TABLE users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_key          TEXT    NOT NULL UNIQUE,
  username             TEXT    NOT NULL COLLATE NOCASE,
  display_name         TEXT    NOT NULL DEFAULT '',
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL DEFAULT 'user'
                         CHECK (role IN ('admin', 'user')),
  status               TEXT    NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0
                         CHECK (must_change_password IN (0, 1)),
  failed_attempts      INTEGER NOT NULL DEFAULT 0
                         CHECK (failed_attempts >= 0),
  locked_until         INTEGER,
  last_login_at        INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,

  CONSTRAINT ck_users_username_len CHECK (length(username) BETWEEN 1 AND 64),
  CONSTRAINT ck_users_display_len  CHECK (length(display_name) <= 64),
  CONSTRAINT uq_users_username     UNIQUE (username)
) STRICT;

-- 单管理员：数据库层兜底，避免业务层漏判
CREATE UNIQUE INDEX uq_users_single_admin ON users(role) WHERE role = 'admin';
CREATE INDEX idx_users_status ON users(status);

-- 配额（与 users 1:1；quota_bytes 为 NULL 表示不限量）
CREATE TABLE quotas (
  user_id     INTEGER PRIMARY KEY
                REFERENCES users(id) ON DELETE CASCADE,
  quota_bytes INTEGER
                CHECK (quota_bytes IS NULL OR quota_bytes >= 0),
  used_bytes  INTEGER NOT NULL DEFAULT 0
                CHECK (used_bytes >= 0),
  updated_at  INTEGER NOT NULL
) STRICT;

-- 会话（只存 token 的 SHA-256，库文件泄露也无法直接冒用会话）
CREATE TABLE sessions (
  id_hash      TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  revoked_at   INTEGER
) STRICT;

CREATE INDEX idx_sessions_user   ON sessions(user_id);
CREATE INDEX idx_sessions_expire ON sessions(expires_at);

-- 键值设置（value 为 JSON 文本，读取时经 zod 校验）
CREATE TABLE settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
) STRICT;

-- 审计日志（actor_id 刻意不加外键：用户删除后日志仍须保留）
CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  actor_type  TEXT    NOT NULL
                CHECK (actor_type IN ('admin', 'user', 'system', 'anonymous')),
  actor_id    INTEGER,
  action      TEXT    NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  target_path TEXT,
  result      TEXT    NOT NULL
                CHECK (result IN ('success', 'denied', 'error')),
  ip          TEXT,
  user_agent  TEXT,
  request_id  TEXT,
  detail      TEXT
) STRICT;

CREATE INDEX idx_audit_ts     ON audit_logs(ts DESC);
CREATE INDEX idx_audit_actor  ON audit_logs(actor_id, ts DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, ts DESC);

-- 默认设置（用户首次启动即可用；后续由 settingsService 统一读写）
INSERT INTO settings (key, value, updated_at) VALUES
  ('server.online',              'false',        CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('server.port',                '8686',         CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('server.bind',                '"0.0.0.0"',    CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('security.sessionTtlHours',   '168',          CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('security.maxLoginFailures',  '5',            CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('upload.maxFileBytes',        '2147483648',   CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ('frp.enabled',                'false',        CAST(unixepoch('subsec') * 1000 AS INTEGER));
