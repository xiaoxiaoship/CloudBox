-- Per-user successful login IP history for the account IP column.
CREATE TABLE IF NOT EXISTS user_login_ips (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  login_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, ip)
);
CREATE INDEX IF NOT EXISTS idx_user_login_ips_last_seen ON user_login_ips(user_id, last_seen_at DESC);
