// 管理员停止发布：玩家立即无法进入，线上内容保留以便更新后再发布
import { json, requireAdmin } from '../../../../_shared.js';
import { gameById } from '../../../../_games.js';

export async function onRequestPost({ request, env, params }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  const row = await gameById(env, params.id);
  if (!row) return json({ error: '游戏不存在' }, 404);

  const now = Date.now();
  await env.DB.prepare("UPDATE games SET status = 'draft', updated_at = ? WHERE id = ?")
    .bind(now, params.id).run();

  return json({ ok: true, status: 'draft', updated_at: now });
}
