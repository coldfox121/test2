// 注册：用户名 + 密码，创建账号并直接返回登录态
import { json, randomHex, hashPassword, isValidUsername, createSession } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const username = String(body.username || '').toLowerCase();
  const password = String(body.password || '');

  if (!isValidUsername(username)) {
    return json({ error: '账号需为 3-16 位字母、数字或下划线' }, 400);
  }
  if (password.length < 6 || password.length > 64) {
    return json({ error: '密码需为 6-64 位' }, 400);
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) {
    return json({ error: '该账号已被注册' }, 409);
  }

  const id = randomHex(16);
  const salt = randomHex(16);
  const passHash = await hashPassword(password, salt);

  await env.DB.prepare(
    'INSERT INTO users (id, username, pass_hash, salt, save, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, username, passHash, salt, '', null, Date.now()).run();

  const token = await createSession(env, id);
  return json({ token, username });
}
