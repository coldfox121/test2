-- test2 文字冒险平台：管理员账号 + 多款游戏
-- users 仅用于管理员登录；玩家不再注册，进度存在浏览器本地

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  save TEXT NOT NULL DEFAULT '',
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);

-- 会话只存 token 的 SHA-256 散列
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 每款游戏一行：code 是玩家访问链接里的随机长码
-- status: draft = 私有；published = 已发布（玩家可进入）
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  draft TEXT NOT NULL DEFAULT '',
  published TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  draft_updated_at INTEGER,
  draft_updated_by TEXT,
  published_at INTEGER,
  published_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_code ON games(code);

-- 每次发布保留快照，可恢复为草稿
CREATE TABLE IF NOT EXISTS game_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_game_versions_game ON game_versions(game_id, id DESC);
