// 玩家入口 /g/<code>：返回玩家页面，URL 保持不变（随机码由前端从路径读取）
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL('/play.html', url.origin));
  const headers = new Headers(page.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(page.body, { status: 200, headers });
}
