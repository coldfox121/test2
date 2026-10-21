// 健康检查：前端用它判断当前环境是否有云后端
import { json } from '../_shared.js';

export function onRequestGet() {
  return json({ ok: true });
}
