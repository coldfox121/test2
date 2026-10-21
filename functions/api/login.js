// 登录：校验密码，返回新会话
import { json, hashPassword, isValidUsername, createSession } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const username = String(body.username || '').toLowerCase();
  const password = String(body.password || '');

  if (!isValidUsername(username) || !password) {
    return json({ error: '账号或密码错误' }, 401);
  }

  const user = await env.DB.prepare(
    'SELECT id, username, pass_hash, salt FROM users WHERE username = ?'
  ).bind(username).first();

  if (!user) {
    return json({ error: '账号或密码错误' }, 401);
  }

  const passHash = await hashPassword(password, user.salt);
  if (passHash !== user.pass_hash) {
    return json({ error: '账号或密码错误' }, 401);
  }

  const token = await createSession(env, user.id);
  return json({ token, username: user.username });
}
