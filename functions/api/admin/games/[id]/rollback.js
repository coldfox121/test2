// 管理员把某款游戏的历史版本恢复为草稿（不影响线上，需再发布）
import { json, requireAdmin } from '../../../../_shared.js';
import { validateStory } from '../../../../_story-validate.js';
import { gameById } from '../../../../_games.js';

export async function onRequestPost({ request, env, params }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const id = Number(body && body.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: '版本 id 无效' }, 400);

  const row = await env.DB.prepare(
    'SELECT id, version, content FROM game_versions WHERE id = ? AND game_id = ?'
  ).bind(id, params.id).first();
  if (!row) return json({ error: '版本不存在' }, 404);

  let story;
  try {
    story = JSON.parse(row.content);
  } catch {
    return json({ error: '该版本数据已损坏' }, 400);
  }

  const errors = validateStory(story);
  if (errors.length) {
    return json({ error: '该版本数据不完整：' + errors[0], errors: errors }, 400);
  }

  const game = await gameById(env, params.id);
  if (!game) return json({ error: '游戏不存在' }, 404);

  const now = Date.now();
  await env.DB.prepare(
    'UPDATE games SET draft = ?, draft_updated_at = ?, draft_updated_by = ?, updated_at = ? WHERE id = ?'
  ).bind(JSON.stringify(story), now, admin.username, now, params.id).run();

  return json({
    ok: true,
    story,
    version: row.version,
    draft_updated_at: now,
    draft_updated_by: admin.username
  });
}
