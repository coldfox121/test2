// 管理员查看发布历史
import { json, requireAdmin } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  const rows = await env.DB.prepare(
    'SELECT id, version, note, created_at, created_by FROM story_versions ORDER BY id DESC LIMIT 50'
  ).all();

  return json({ versions: rows.results || [] });
}
