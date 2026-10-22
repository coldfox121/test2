// 管理员：读取单个游戏详情 / 改名 / 删除
import { json, requireAdmin } from '../../../../_shared.js';
import { gameById } from '../../../../_games.js';

function parseDraft(row) {
  if (!row || !row.draft) return null;
  try {
    return JSON.parse(row.draft);
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env, params }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  const row = await gameById(env, params.id);
  if (!row) return json({ error: '游戏不存在' }, 404);

  return json({
    game: {
      id: row.id,
      code: row.code,
      title: row.title,
      status: row.status,
      version: row.version || 0,
      draft_updated_at: row.draft_updated_at || null,
      draft_updated_by: row.draft_updated_by || null,
      published_at: row.published_at || null,
      published_by: row.published_by || null,
      created_at: row.created_at,
      updated_at: row.updated_at
    },
    draft: parseDraft(row)
  });
}

export async function onRequestPut({ request, env, params }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  const title = String(body.title || '').trim().slice(0, 60);
  if (!title) return json({ error: '请填写游戏名称' }, 400);

  const row = await gameById(env, params.id);
  if (!row) return json({ error: '游戏不存在' }, 404);

  const now = Date.now();
  await env.DB.prepare('UPDATE games SET title = ?, updated_at = ? WHERE id = ?')
    .bind(title, now, params.id).run();

  return json({ ok: true, title, updated_at: now });
}

export async function onRequestDelete({ request, env, params }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  const row = await gameById(env, params.id);
  if (!row) return json({ error: '游戏不存在' }, 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM game_versions WHERE game_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM games WHERE id = ?').bind(params.id)
  ]);

  return json({ ok: true });
}
