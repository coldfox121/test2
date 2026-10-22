// 管理员上传剧情配图到 KV，返回可直接访问的站内地址
import { json, requireAdmin } from '../../_shared.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// 只认常见位图格式，同时按文件头校验，避免伪装成图片的文件进入 KV
function imageExt(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'webp';
  return null;
}

const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp'
};

export async function onRequestPost({ request, env }) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: '需要管理员权限' }, 401);
  if (!env.IMAGES) return json({ error: '服务端未绑定图片存储（IMAGES）' }, 500);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: '上传格式错误' }, 400);
  }

  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return json({ error: '没有收到图片文件' }, 400);
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength === 0) return json({ error: '图片是空文件' }, 400);
  if (buffer.byteLength > MAX_IMAGE_BYTES) return json({ error: '图片不能超过 10MB' }, 400);

  const bytes = new Uint8Array(buffer);
  const ext = imageExt(bytes);
  if (!ext) return json({ error: '仅支持 JPG、PNG、GIF、WebP 图片' }, 400);

  const key = 'story/' + crypto.randomUUID() + '.' + ext;
  await env.IMAGES.put(key, buffer, {
    metadata: {
      contentType: CONTENT_TYPES[ext],
      uploader: admin.username,
      originalName: String(file.name || '').slice(0, 200)
    }
  });

  return json({
    ok: true,
    key,
    url: '/api/images/' + key,
    size: buffer.byteLength,
    type: CONTENT_TYPES[ext]
  });
}
