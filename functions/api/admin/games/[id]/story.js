// 管理员：读取 / 保存某款游戏的剧情草稿
import { json, requireAdmin } from '../../../../_shared.js';
import { validateStory, storyTooLarge } from '../../../../_story-validate.js';
import { gameById } from '../../../../_games.js';

export async function onRequestGet({ request, env, params }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  const row = await gameById(env, params.id);
  if (!row) return json({ error: '游戏不存在' }, 404);

  let draft = null;
  if (row.draft) {
    try {
      draft = JSON.parse(row.draft);
    } catch {
      draft = null;
    }
  }

  return json({
    draft,
    version: row.version || 0,
    status: row.status,
    draft_updated_at: row.draft_updated_at || null,
    draft_updated_by: row.draft_updated_by || null,
    published_at: row.published_at || null,
    published_by: row.published_by || null,
    admin: admin.username
  });
}

export async function onRequestPut({ request, env, params }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, 400);
  }

  const story = body && body.story;
  if (storyTooLarge(story)) return json({ error: '剧情数据超过 1MB 上限' }, 400);

  const errors = validateStory(story);
  if (errors.length) {
    return json({ error: errors[0], errors: errors }, 400);
  }

  const row = await gameById(env, params.id);
  if (!row) return json({ error: '游戏不存在' }, 404);

  const now = Date.now();
  await env.DB.prepare(
    'UPDATE games SET draft = ?, draft_updated_at = ?, draft_updated_by = ?, updated_at = ? WHERE id = ?'
  ).bind(JSON.stringify(story), now, admin.username, now, params.id).run();

  return json({ ok: true, draft_updated_at: now, draft_updated_by: admin.username });
}
