-- Feature-specific IP/account bans produced by the policy editor.
CREATE TABLE IF NOT EXISTS security_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK(scope IN ('ip','account')),
  target TEXT NOT NULL,
  feature TEXT NOT NULL,
  until INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_bans_target ON security_bans(scope, target, until DESC);
