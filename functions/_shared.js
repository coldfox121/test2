// Pages Functions 公共工具：密码散列、会话、鉴权
const encoder = new TextEncoder();

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 会话 30 天有效

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export function randomHex(byteCount) {
  const arr = new Uint8Array(byteCount);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

// PBKDF2-SHA256，10 万次迭代
export async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: 100000 },
    key,
    256
  );
  return toHex(bits);
}

export function isValidUsername(username) {
  return /^[a-z0-9_]{3,16}$/.test(username);
}

// 管理员由环境变量 ADMIN_USERNAME 指定，账号匹配即拥有编辑权限
export function roleOf(user, env) {
  const adminName = String((env && env.ADMIN_USERNAME) || '').trim().toLowerCase();
  if (!adminName || !user || !user.username) return 'player';
  return String(user.username).toLowerCase() === adminName ? 'admin' : 'player';
}

export function isAdmin(user, env) {
  return roleOf(user, env) === 'admin';
}

// 从 Authorization: Bearer <token> 解析出登录用户，无效或过期返回 null
export async function getAuthUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+([0-9a-f]{64})$/i);
  if (!match) return null;

  const tokenHash = await sha256Hex(match[1].toLowerCase());
  const row = await env.DB.prepare(
    'SELECT s.token_hash, s.user_id, s.expires_at, u.username, u.save, u.last_seen ' +
    'FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  ).bind(tokenHash).first();

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return row;
}

export async function createSession(env, userId) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, userId, Date.now() + SESSION_TTL_MS)
    .run();
  return token;
}

// 管理员接口统一入口：未登录、非管理员都返回 401
export async function requireAdmin(request, env) {
  const user = await getAuthUser(request, env);
  if (!user || !isAdmin(user, env)) return null;
  return user;
}
