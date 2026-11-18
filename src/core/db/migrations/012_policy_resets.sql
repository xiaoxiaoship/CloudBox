-- Counters must restart after a target-level ban is cleared.
CREATE TABLE IF NOT EXISTS security_policy_resets (
  scope TEXT NOT NULL CHECK(scope IN ('ip','account')),
  target TEXT NOT NULL,
  reset_at INTEGER NOT NULL,
  PRIMARY KEY (scope, target)
);
