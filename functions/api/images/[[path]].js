// 读取 KV 中的剧情配图：/api/images/story/<uuid>.<ext>
export async function onRequestGet({ params, env }) {
  if (!env.IMAGES) return new Response('Image storage binding missing', { status: 500 });

  const raw = params.path;
  const key = (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\/+/, '');

  if (!/^story\/[A-Za-z0-9-]+\.[a-z0-9]+$/.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const { value, metadata } = await env.IMAGES.getWithMetadata(key, { type: 'arrayBuffer' });
  if (!value) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', (metadata && metadata.contentType) || 'application/octet-stream');
  // key 使用随机 UUID，内容不会变化，可长期缓存
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(value, { headers });
}
