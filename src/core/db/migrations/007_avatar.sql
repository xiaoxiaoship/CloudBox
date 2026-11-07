-- 用户头像：以受限大小的 data URL 存储在用户记录中
ALTER TABLE users ADD COLUMN avatar_data TEXT;
