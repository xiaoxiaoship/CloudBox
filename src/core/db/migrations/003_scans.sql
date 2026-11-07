-- ============================================================================
-- 003_scans.sql — 文件安全查杀结果（按用户 + 相对路径持久化）
-- 结果用于下载/分享/解压强制拦截；上传覆盖、重命名、删除时由 FileService 清理。
-- ============================================================================

CREATE TABLE file_scans (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path  TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('clean', 'infected', 'failed')),
  sha256     TEXT,
  engine     TEXT,
  details    TEXT,
  scanned_at INTEGER NOT NULL,

  PRIMARY KEY (user_id, file_path),
  CONSTRAINT ck_file_scans_path_len CHECK (length(file_path) BETWEEN 1 AND 900)
) STRICT;

CREATE INDEX idx_file_scans_status ON file_scans(status);
