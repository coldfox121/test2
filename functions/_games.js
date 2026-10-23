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

// 新游戏的起始剧情模板，保证校验通过
// template: blank（空白）/ three-act（三幕式）/ tutorial（教程）/ multi-ending（多结局）
export function starterStory(title, template) {
  const scenes = { default: PLACEHOLDER };

  if (template === 'three-act') {
    return {
      start: '第一幕_开端',
      theme: 'jade',
      font: 'default',
      scenes,
      nodes: {
        '第一幕_开端': {
          scene: 'default',
          text: '《' + title + '》\n\n第一幕：把主角放进一个具体的场景里，交代他想要什么、被什么挡住。',
          choices: [{ text: '进入第二幕', next: '第二幕_发展' }]
        },
        '第二幕_发展': {
          scene: 'default',
          text: '第二幕：冲突升级。让主角付出代价，或者发现事情和想象的不一样。',
          choices: [{ text: '走向高潮', next: '第三幕_高潮' }]
        },
        '第三幕_高潮': {
          scene: 'default',
          text: '第三幕：做最后一次选择。这里可以分叉成多个结局。',
          choices: [{ text: '落幕', next: '终章' }]
        },
        '终章': {
          scene: 'default',
          text: '故事结束。改写这段文字，写下你的结局。',
          ending: { id: '结局_标准', title: '故事落幕', tone: '结局', hint: '三幕式结构的收尾。' }
        }
      },
      endings: [{ id: '结局_标准', title: '故事落幕', hint: '三幕式结构的收尾。' }]
    };
  }

  if (template === 'tutorial') {
    return {
      start: '教程_开场',
      theme: 'indigo',
      font: 'default',
      scenes,
      vars: [{ id: '金币', name: '金币', init: 0 }],
      nodes: {
        '教程_开场': {
          scene: 'default',
          text: '欢迎使用教程模板。\n\n这个模板演示三件事：**分支**、**旗标**、**数值属性**。\n\n你现在有 0 金币，先做一个选择。',
          choices: [
            { text: '捡起路边的钱袋（金币+3）', next: '教程_有钱', set: { '金币': '+3', '拿到钱袋': true } },
            { text: '什么都不做', next: '教程_空手', set: { '洁身自好': true } }
          ]
        },
        '教程_有钱': {
          scene: 'default',
          text: '你捡到了 3 枚金币。旗标「拿到钱袋」已设置，后面可以用它做条件。',
          choices: [
            { text: '花钱买通守卫（需要金币>=3）', next: '教程_通关', req: ['金币>=3'], set: { '金币': '-3' } },
            { text: '原路返回', next: '教程_开场' }
          ]
        },
        '教程_空手': {
          scene: 'default',
          text: '你什么也没拿。守卫看了你一眼，放你过去了。',
          choices: [{ text: '继续走', next: '教程_通关' }]
        },
        '教程_通关': {
          scene: 'default',
          text: '你通过了。\n\n试着在「旗标」页签查看条件、在「属性」页签新增数值，再改写这个模板。',
          ending: { id: '结局_完成教程', title: '教程完成', tone: '结局', hint: '基础用法已经掌握。' }
        }
      },
      endings: [{ id: '结局_完成教程', title: '教程完成', hint: '基础用法已经掌握。' }]
    };
  }

  if (template === 'multi-ending') {
    return {
      start: '岔路',
      theme: 'rose',
      font: 'default',
      scenes,
      nodes: {
        '岔路': {
          scene: 'default',
          text: '《' + title + '》\n\n故事来到一个岔路口，三条路通向三种不同的结局。',
          choices: [
            { text: '走向光', next: '结局_光明' },
            { text: '走向暗', next: '结局_黑暗' },
            { text: '原地不动', next: '结局_平凡' }
          ]
        },
        '结局_光明': {
          scene: 'default',
          text: '你走向了光。',
          ending: { id: '光明', title: '光明结局', tone: '好结局', hint: '第一个结局。' }
        },
        '结局_黑暗': {
          scene: 'default',
          text: '你走向了暗。',
          ending: { id: '黑暗', title: '黑暗结局', tone: '坏结局', hint: '第二个结局。' }
        },
        '结局_平凡': {
          scene: 'default',
          text: '你留在原地，什么也没发生。',
          ending: { id: '平凡', title: '平凡结局', tone: '隐藏结局', hint: '第三个结局。' }
        }
      },
      endings: [
        { id: '光明', title: '光明结局', hint: '第一个结局。' },
        { id: '黑暗', title: '黑暗结局', hint: '第二个结局。' },
        { id: '平凡', title: '平凡结局', hint: '第三个结局。' }
      ]
    };
  }

  // blank
  return {
    start: '开始',
    theme: 'amber',
    font: 'default',
    scenes,
    nodes: {
      '开始': {
        scene: 'default',
        text: '《' + title + '》从这里开始。\n\n在编辑器里改写这段文字，添加属于你的分支。',
        choices: [{ text: '继续', next: '终点' }]
      },
      '终点': {
        scene: 'default',
        text: '（这里是结局。可以在「结局」页签修改标题与提示。）',
        ending: { id: '结局_终点', title: '新的终点', tone: '结局', hint: '回到起点，换一种选择。' }
      }
    },
    endings: [{ id: '结局_终点', title: '新的终点', hint: '回到起点，换一种选择。' }]
  };
}

export function gameById(env, id) {
  return env.DB.prepare(
    'SELECT id, code, title, status, draft, published, version, draft_updated_at, ' +
    'draft_updated_by, published_at, published_by, created_at, updated_at FROM games WHERE id = ?'
  ).bind(id).first();
}
