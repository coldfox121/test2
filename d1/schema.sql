-- test2 云端账号、存档与剧情内容（Cloudflare D1）
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

-- 剧情内容：单行保存草稿与线上版本，version 用于玩家端缓存判断
CREATE TABLE IF NOT EXISTS story (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  draft TEXT NOT NULL DEFAULT '',
  published TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  draft_updated_at INTEGER,
  draft_updated_by TEXT,
  published_at INTEGER,
  published_by TEXT
);

-- 每次发布保留一份快照，可恢复为草稿
CREATE TABLE IF NOT EXISTS story_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT
);

INSERT OR IGNORE INTO story (id, draft, published, version) VALUES (1, '', '', 0);
