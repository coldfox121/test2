// 玩家读取线上剧情：未发布时返回 null，前端回退到内置 story.js
import { json } from '../_shared.js';

export async function onRequestGet({ env }) {
  const row = await env.DB.prepare(
    'SELECT published, version, published_at FROM story WHERE id = 1'
  ).first();

  if (!row || !row.published) {
    return json({ story: null, version: 0, published_at: null });
  }

  let story = null;
  try {
    story = JSON.parse(row.published);
  } catch {
    story = null;
  }

  return json({
    story,
    version: row.version || 0,
    published_at: row.published_at || null
  });
}
