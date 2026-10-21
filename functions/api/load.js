// 读取存档：返回存档、上次保存时间、服务器当前时间（用于离线收益结算）
import { json, getAuthUser } from '../_shared.js';

export async function onRequestGet({ request, env }) {
  const user = await getAuthUser(request, env);
  if (!user) {
    return json({ error: '未登录或登录已过期' }, 401);
  }

  let save = null;
  if (user.save) {
    try {
      save = JSON.parse(user.save);
    } catch {
      save = null;
    }
  }

  return json({
    username: user.username,
    save,
    last_seen: user.last_seen,
    server_now: Date.now()
  });
}
