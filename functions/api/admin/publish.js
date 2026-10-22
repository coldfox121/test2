// 管理员发布草稿：写入线上版本并保存版本快照
import { json, requireAdmin } from '../../_shared.js';
import { validateStory, storyTooLarge } from '../../_story-validate.js';

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }
  const note = String(body.note || '').slice(0, 200);

  const row = await env.DB.prepare('SELECT draft, version FROM story WHERE id = 1').first();
  if (!row || !row.draft) return json({ error: '还没有可发布的草稿' }, 400);

  let story;
  try {
    story = JSON.parse(row.draft);
  } catch {
    return json({ error: '草稿数据已损坏，请重新保存' }, 400);
  }

  if (storyTooLarge(story)) return json({ error: '剧情数据超过 1MB 上限' }, 400);

  const errors = validateStory(story);
  if (errors.length) {
    return json({ error: errors[0], errors: errors }, 400);
  }

  const now = Date.now();
  const version = (row.version || 0) + 1;
  const content = JSON.stringify(story);

  await env.DB.batch([
    env.DB.prepare(
      'UPDATE story SET published = ?, version = ?, published_at = ?, published_by = ? WHERE id = 1'
    ).bind(content, version, now, admin.username),
    env.DB.prepare(
      'INSERT INTO story_versions (version, content, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)'
    ).bind(version, content, note, now, admin.username)
  ]);

  return json({ ok: true, version, published_at: now, published_by: admin.username });
}
