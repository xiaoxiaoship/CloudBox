-- Separate rename statistics window from its lock duration.
ALTER TABLE users ADD COLUMN rename_limited_until INTEGER;
