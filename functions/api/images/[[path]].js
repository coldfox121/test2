// 读取 R2 中的剧情配图：/api/images/story/<uuid>.<ext>
export async function onRequestGet({ params, env, request }) {
  if (!env.IMAGES) return new Response('R2 binding missing', { status: 500 });

  const raw = params.path;
  const key = (Array.isArray(raw) ? raw.join('/') : String(raw || '')).replace(/^\/+/, '');

  if (!/^story\/[A-Za-z0-9-]+\.[a-z0-9]+$/.test(key)) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.IMAGES.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', (object.httpMetadata && object.httpMetadata.contentType) || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');

  if (request.headers.get('If-None-Match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
}
