// 管理员读取 / 保存剧情草稿
import { json, requireAdmin } from '../../_shared.js';
import { validateStory, storyTooLarge } from '../../_story-validate.js';

async function loadRow(env) {
  return env.DB.prepare(
    'SELECT draft, version, draft_updated_at, draft_updated_by, published_at, published_by ' +
    'FROM story WHERE id = 1'
  ).first();
}

export async function onRequestGet({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  const row = await loadRow(env);
  let draft = null;
  if (row && row.draft) {
    try {
      draft = JSON.parse(row.draft);
    } catch {
      draft = null;
    }
  }

  return json({
    draft,
    version: (row && row.version) || 0,
    draft_updated_at: (row && row.draft_updated_at) || null,
    draft_updated_by: (row && row.draft_updated_by) || null,
    published_at: (row && row.published_at) || null,
    published_by: (row && row.published_by) || null,
    admin: admin.username
  });
}

export async function onRequestPut({ request, env }) {
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

  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO story (id, draft, draft_updated_at, draft_updated_by) VALUES (1, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, ' +
    'draft_updated_at = excluded.draft_updated_at, draft_updated_by = excluded.draft_updated_by'
  ).bind(JSON.stringify(story), now, admin.username).run();

  return json({ ok: true, draft_updated_at: now, draft_updated_by: admin.username });
}
