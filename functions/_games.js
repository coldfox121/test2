// 游戏相关的公共工具：随机访问码、新建游戏模板

// 去掉容易混淆的字符（0/o、1/l/i），20 位随机码无法被猜中
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function randomCode(length = 20) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

// 1x1 透明 PNG，作为新游戏的默认场景图，避免校验时报“缺少图片地址”
const PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// 新游戏的起始剧情：一个起点 + 一个结局，保证校验通过
export function starterStory(title) {
  return {
    start: 'start',
    scenes: { default: PLACEHOLDER },
    nodes: {
      start: {
        scene: 'default',
        text: '《' + title + '》从这里开始。\n\n在编辑器里改写这段文字，添加属于你的分支。',
        choices: [{ text: '继续', next: 'ending' }]
      },
      ending: {
        scene: 'default',
        text: '（这里是结局。可以在「结局」页签修改标题与提示。）',
        ending: { id: 'ending1', title: '新的终点', tone: '结局', hint: '回到起点，换一种选择。' }
      }
    },
    endings: [{ id: 'ending1', title: '新的终点', hint: '回到起点，换一种选择。' }]
  };
}

export function gameById(env, id) {
  return env.DB.prepare(
    'SELECT id, code, title, status, draft, published, version, draft_updated_at, ' +
    'draft_updated_by, published_at, published_by, created_at, updated_at FROM games WHERE id = ?'
  ).bind(id).first();
}
