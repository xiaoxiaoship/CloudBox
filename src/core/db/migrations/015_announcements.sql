CREATE TABLE IF NOT EXISTS announcements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category       TEXT    NOT NULL CHECK (category IN ('critical', 'warning', 'info')),
  audience       TEXT    NOT NULL CHECK (audience IN ('all', 'user')),
  target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  body           TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  CHECK (
    (audience = 'all' AND target_user_id IS NULL) OR
    (audience = 'user' AND target_user_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_announcements_target ON announcements(target_user_id);
CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         INTEGER NOT NULL,
  PRIMARY KEY (announcement_id, user_id)
) STRICT;
