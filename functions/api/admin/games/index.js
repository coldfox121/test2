// 管理员：游戏列表 / 新建游戏
import { json, requireAdmin, randomHex } from '../../../_shared.js';
import { randomCode, starterStory } from '../../../_games.js';

export async function onRequestGet({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);

  const rows = await env.DB.prepare(
    'SELECT id, code, title, status, version, draft_updated_at, published_at, created_at, updated_at ' +
    'FROM games ORDER BY created_at DESC'
  ).all();

  return json({ games: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
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

  const id = randomHex(16);
  const code = randomCode(20);
  const now = Date.now();
  const story = starterStory(title);

  await env.DB.prepare(
    'INSERT INTO games (id, code, title, status, draft, published, version, draft_updated_at, ' +
    'draft_updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)'
  ).bind(id, code, title, 'draft', JSON.stringify(story), '', now, admin.username, now, now).run();

  return json({ ok: true, game: { id, code, title, status: 'draft', version: 0, created_at: now, updated_at: now } });
}
