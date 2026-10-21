-- test1 云端账号与存档（Cloudflare D1）
-- users.save 保存完整游戏进度的 JSON 字符串，last_seen 为服务器毫秒时间戳
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  save TEXT NOT NULL DEFAULT '',
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);

-- 会话只存 token 的 SHA-256 散列，数据库泄露也无法伪造登录态
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
