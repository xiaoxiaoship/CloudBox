CREATE TABLE IF NOT EXISTS plugin_user_meta (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meta_key   TEXT    NOT NULL,
  meta_value TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, meta_key)
) STRICT;
