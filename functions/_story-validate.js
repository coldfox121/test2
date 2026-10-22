// 剧情数据校验：服务端保存草稿、发布前各执行一次，避免写坏线上剧情
export const MAX_STORY_BYTES = 1024 * 1024;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFlagList(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return true;
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function validateStory(story) {
  const errors = [];

  if (!isPlainObject(story)) return ['剧情数据必须是对象'];

  if (typeof story.start !== 'string' || !story.start) errors.push('缺少起点节点 start');
  if (!isPlainObject(story.scenes)) errors.push('scenes 必须是对象');
  if (!isPlainObject(story.nodes)) errors.push('nodes 必须是对象');
  if (!Array.isArray(story.endings)) errors.push('endings 必须是数组');
  if (errors.length) return errors;

  const sceneKeys = new Set(Object.keys(story.scenes));
  const nodeIds = new Set(Object.keys(story.nodes));
  const endingIds = new Set();

  if (nodeIds.size === 0) errors.push('剧情至少需要一个节点');
  if (nodeIds.size > 500) errors.push('节点数量超过 500 个上限');

  sceneKeys.forEach(key => {
    if (!/^[A-Za-z0-9_\-\u4e00-\u9fff]+$/.test(key)) errors.push('场景键 "' + key + '" 只能包含中文、字母、数字、下划线和短横线');
    if (typeof story.scenes[key] !== 'string' || !story.scenes[key]) {
      errors.push('场景 "' + key + '" 缺少图片地址');
    }
  });

  story.endings.forEach((ending, index) => {
    if (!isPlainObject(ending)) {
      errors.push('第 ' + (index + 1) + ' 个结局格式错误');
      return;
    }
    if (typeof ending.id !== 'string' || !ending.id) {
      errors.push('第 ' + (index + 1) + ' 个结局缺少 id');
    } else if (endingIds.has(ending.id)) {
      errors.push('结局 id "' + ending.id + '" 重复');
    } else {
      endingIds.add(ending.id);
    }
    if (typeof ending.title !== 'string') errors.push('结局 "' + (ending.id || index) + '" 缺少标题');
    if (ending.hint !== undefined && typeof ending.hint !== 'string') {
      errors.push('结局 "' + (ending.id || index) + '" 的提示必须是文字');
    }
  });

  if (!nodeIds.has(story.start)) errors.push('起点节点 "' + story.start + '" 不存在');

  Object.keys(story.nodes).forEach(id => {
    const node = story.nodes[id];
    const label = '节点 "' + id + '"';

    if (!/^[A-Za-z0-9_\-\u4e00-\u9fff]+$/.test(id)) {
      errors.push(label + ' 的 id 只能包含中文、字母、数字、下划线和短横线');
    }
    if (!isPlainObject(node)) {
      errors.push(label + ' 格式错误');
      return;
    }
    if (typeof node.text !== 'string') errors.push(label + ' 的正文必须是文字');
    if (typeof node.text === 'string' && node.text.length > 20000) errors.push(label + ' 的正文超过 20000 字');
    if (typeof node.scene !== 'string' || !node.scene) {
      errors.push(label + ' 缺少场景');
    } else if (!sceneKeys.has(node.scene)) {
      errors.push(label + ' 引用了不存在的场景 "' + node.scene + '"');
    }
    if (node.set !== undefined && !isPlainObject(node.set)) errors.push(label + ' 的 set 必须是对象');

    if (node.ending) {
      if (!isPlainObject(node.ending)) {
        errors.push(label + ' 的结局字段格式错误');
      } else {
        if (typeof node.ending.id !== 'string' || !node.ending.id) {
          errors.push(label + ' 的结局缺少 id');
        } else if (!endingIds.has(node.ending.id)) {
          errors.push(label + ' 引用了结局列表里不存在的结局 "' + node.ending.id + '"');
        }
        if (node.ending.title !== undefined && typeof node.ending.title !== 'string') {
          errors.push(label + ' 的结局标题必须是文字');
        }
        if (node.ending.tone !== undefined && typeof node.ending.tone !== 'string') {
          errors.push(label + ' 的结局标签必须是文字');
        }
      }
      return;
    }

    if (!Array.isArray(node.choices)) {
      errors.push(label + ' 不是结局节点，必须提供 choices 数组');
      return;
    }
    if (node.choices.length === 0) errors.push(label + ' 不是结局节点，至少需要一个选项');

    node.choices.forEach((choice, index) => {
      const choiceLabel = label + ' 的第 ' + (index + 1) + ' 个选项';
      if (!isPlainObject(choice)) {
        errors.push(choiceLabel + ' 格式错误');
        return;
      }
      if (typeof choice.text !== 'string') errors.push(choiceLabel + ' 的文字必须是字符串');
      if (!isFlagList(choice.req)) errors.push(choiceLabel + ' 的 req 必须是字符串或数组');
      if (!isFlagList(choice.hideUnless)) errors.push(choiceLabel + ' 的 hideUnless 必须是字符串或数组');
      if (choice.set !== undefined && !isPlainObject(choice.set)) errors.push(choiceLabel + ' 的 set 必须是对象');
      if (choice.lock !== undefined && typeof choice.lock !== 'string') errors.push(choiceLabel + ' 的 lock 必须是文字');

      const next = choice.next;
      if (typeof next === 'string') {
        if (!nodeIds.has(next)) errors.push(choiceLabel + ' 跳转到了不存在的节点 "' + next + '"');
      } else if (Array.isArray(next)) {
        if (next.length === 0) errors.push(choiceLabel + ' 的分支数组不能为空');
        next.forEach((branch, branchIndex) => {
          const branchLabel = choiceLabel + ' 分支 ' + (branchIndex + 1);
          if (!isPlainObject(branch)) {
            errors.push(branchLabel + ' 格式错误');
            return;
          }
          if (!isFlagList(branch.req)) errors.push(branchLabel + ' 的 req 必须是字符串或数组');
          if (typeof branch.next !== 'string' || !nodeIds.has(branch.next)) {
            errors.push(branchLabel + ' 跳转到了不存在的节点 "' + branch.next + '"');
          }
        });
      } else {
        errors.push(choiceLabel + ' 缺少跳转目标 next');
      }
    });
  });

  return errors;
}

export function storyTooLarge(story) {
  return JSON.stringify(story).length > MAX_STORY_BYTES;
}
