// 写入存档：last_seen 由服务器生成，防止篡改本地时间刷离线收益
import { json, getAuthUser } from '../_shared.js';

const MAX_SAVE_BYTES = 512 * 1024;

export async function onRequestPost({ request, env }) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return json({ error: '未登录或登录已过期' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  if (!body || typeof body.save !== 'object' || body.save === null || Array.isArray(body.save)) {
    return json({ error: '存档格式错误' }, 400);
  }

  const saveText = JSON.stringify(body.save);
  if (saveText.length > MAX_SAVE_BYTES) {
    return json({ error: '存档过大' }, 400);
  }

  const now = Date.now();
  await env.DB.prepare('UPDATE users SET save = ?, last_seen = ? WHERE id = ?')
    .bind(saveText, now, user.user_id)
    .run();

  return json({ ok: true, server_now: now });
}
