// 玩家读取某款游戏的线上剧情：只有已发布状态才可见
import { json } from '../../_shared.js';

export async function onRequestGet({ params, env }) {
  const code = String(params.code || '');
  if (!/^[a-z0-9]{8,64}$/.test(code)) return json({ error: '链接无效' }, 404);

  const row = await env.DB.prepare(
    'SELECT title, status, published, version, published_at FROM games WHERE code = ?'
  ).bind(code).first();

  if (!row || row.status !== 'published' || !row.published) {
    return json({ error: '链接无效或暂未开放' }, 404);
  }

  let story = null;
  try {
    story = JSON.parse(row.published);
  } catch {
    story = null;
  }
  if (!story) return json({ error: '剧情数据异常' }, 500);

  return json({
    title: row.title,
    story,
    version: row.version || 0,
    published_at: row.published_at || null
  });
}
