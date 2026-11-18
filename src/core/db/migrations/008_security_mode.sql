-- Per-user read-only security mode.
ALTER TABLE users ADD COLUMN security_mode INTEGER NOT NULL DEFAULT 0 CHECK (security_mode IN (0, 1));
