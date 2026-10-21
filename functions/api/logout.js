// 登出：删除当前会话
import { json, getAuthUser } from '../_shared.js';

export async function onRequestPost({ request, env }) {
  const user = await getAuthUser(request, env);
  if (user) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.token_hash).run();
  }
  return json({ ok: true });
}
