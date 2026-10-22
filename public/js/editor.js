/* 雾亭站 · 剧情编辑器（管理员）
 * 草稿 → 保存 → 发布，支持节点/分支/场景配图/结局/校验/版本恢复
 */
(function () {
  'use strict';

  const NODE_ID_RE = /^[A-Za-z0-9_-]+$/;
  let layer;
  let side;
  let main;
  let metaEl;
  let statusEl;
  let dirtyEl;
  let tabsEl;

  let draft = null;
  let meta = {};
  let tab = 'nodes';
  let selectedNode = null;
  let selectedScene = null;
  let selectedEnding = null;
  let nodeFilter = '';
  let dirty = false;
  let draftSaved = false;
  let busy = false;
  let versionsCache = null;

  /* ---------------- 基础工具 ---------------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function toast(message) {
    if (window.Game) window.Game.toast(message);
  }

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function markDirty() {
    dirty = true;
    updateDirtyLabel();
  }

  function clearDirty() {
    dirty = false;
    updateDirtyLabel();
  }

  function updateDirtyLabel() {
    if (!dirtyEl) return;
    dirtyEl.textContent = dirty ? '有未保存修改' : '已同步';
    dirtyEl.classList.toggle('dirty', dirty);
  }

  function stamp(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('zh-CN', { hour12: false });
    } catch (err) {
      return '—';
    }
  }

  function nodeIds() {
    return draft && draft.nodes ? Object.keys(draft.nodes) : [];
  }

  function optionsHtml(ids, selected) {
    let html = '';
    if (selected && ids.indexOf(selected) === -1) {
      html += '<option value="' + esc(selected) + '" selected>（无效）' + esc(selected) + '</option>';
    }
    ids.forEach(function (id) {
      html += '<option value="' + esc(id) + '"' + (id === selected ? ' selected' : '') + '>' + esc(id) + '</option>';
    });
    if (!ids.length) html = '<option value="">（无节点）</option>';
    return html;
  }

  function nodeSelect(selected, attrs) {
    return '<select ' + (attrs || '') + '>' + optionsHtml(nodeIds(), selected) + '</select>';
  }

  function sceneKeys() {
    return draft && draft.scenes ? Object.keys(draft.scenes) : [];
  }

  function flagsToText(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return Object.keys(obj).filter(function (key) { return obj[key]; }).join(', ');
  }

  function parseFlags(text) {
    const result = {};
    String(text || '').split(/[,，\s]+/).filter(Boolean).forEach(function (key) {
      result[key] = true;
    });
    return Object.keys(result).length ? result : undefined;
  }

  function listToText(value) {
    if (Array.isArray(value)) return value.join(', ');
    return value ? String(value) : '';
  }

  function parseList(text) {
    const list = String(text || '').split(/[,，\s]+/).filter(Boolean);
    return list.length ? list : undefined;
  }

  function sceneUsage(key) {
    return nodeIds().filter(function (id) {
      return draft.nodes[id].scene === key;
    });
  }

  function endingUsage(id) {
    return nodeIds().filter(function (nodeId) {
      const ending = draft.nodes[nodeId].ending;
      return ending && ending.id === id;
    });
  }

  function uniqueId(base, pool) {
    if (!pool[base]) return base;
    let index = 2;
    while (pool[base + '_' + index]) index += 1;
    return base + '_' + index;
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  async function open() {
    if (!window.Game || window.Game.role() !== 'admin') {
      if (window.Game) window.Game.toast('需要管理员权限');
      return;
    }
    if (!layer || !layer.hidden) return;

    layer.hidden = false;
    document.body.classList.add('editor-open');
    setStatus('加载草稿…');

    try {
      const data = await window.Game.api('admin/story');
      meta = data || {};

      if (data && data.draft && data.draft.nodes && data.draft.nodes[data.draft.start]) {
        draft = clone(data.draft);
        draftSaved = true;
        setStatus('已加载云端草稿');
      } else {
        draft = clone(window.Game.story());
        draftSaved = false;
        setStatus('首次编辑：已用当前线上剧情生成草稿');
      }

      selectedNode = draft.start;
      selectedScene = sceneKeys()[0] || null;
      selectedEnding = draft.endings[0] ? draft.endings[0].id : null;
      nodeFilter = '';
      versionsCache = null;
      tab = 'nodes';
      dirty = false;
      updateDirtyLabel();
      render();
    } catch (err) {
      setStatus('加载失败：' + err.message);
      toast('加载草稿失败：' + err.message);
    }
  }

  function close() {
    if (busy) return;
    if (dirty && !confirm('草稿有未保存的修改，确定关闭编辑器吗？')) return;
    layer.hidden = true;
    document.body.classList.remove('editor-open');
  }

  /* ---------------- 渲染框架 ---------------- */

  function render() {
    if (!draft) return;

    tabsEl.querySelectorAll('[data-tab]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.tab === tab);
    });

    metaEl.textContent = '线上 v' + (meta.version || 0) +
      (meta.draft_updated_at ? ' · 草稿 ' + stamp(meta.draft_updated_at) : ' · 草稿未保存');

    renderSide();
    renderMain();
    updateDirtyLabel();
  }

  function renderSide() {
    if (tab === 'nodes') {
      side.innerHTML =
        '<div class="ed-side-head">' +
          '<input id="edNodeFilter" class="ed-input" placeholder="搜索节点…" value="' + esc(nodeFilter) + '">' +
          '<button type="button" class="btn-secondary" data-act="add-node">+ 节点</button>' +
        '</div>' +
        '<label class="ed-side-label">起点节点</label>' +
        '<select id="edStartSelect" class="ed-input">' + optionsHtml(nodeIds(), draft.start) + '</select>' +
        '<div class="ed-list" id="edNodeList">' + nodeListHtml() + '</div>';
      return;
    }

    if (tab === 'scenes') {
      const rows = sceneKeys().map(function (key) {
        const used = sceneUsage(key).length;
        return '<button type="button" class="ed-list-item' + (key === selectedScene ? ' active' : '') +
          '" data-scene="' + esc(key) + '">' +
          '<span class="ed-list-name">' + esc(key) + '</span>' +
          '<span class="ed-list-tag">' + used + ' 处</span>' +
        '</button>';
      }).join('');

      side.innerHTML =
        '<div class="ed-side-head"><button type="button" class="btn-secondary" data-act="add-scene">+ 场景</button></div>' +
        '<div class="ed-list">' + (rows || '<p class="ed-hint">还没有场景</p>') + '</div>';
      return;
    }

    if (tab === 'endings') {
      const rows = draft.endings.map(function (ending) {
        const used = endingUsage(ending.id).length;
        return '<button type="button" class="ed-list-item' + (ending.id === selectedEnding ? ' active' : '') +
          '" data-ending="' + esc(ending.id) + '">' +
          '<span class="ed-list-name">' + esc(ending.title || ending.id) + '</span>' +
          '<span class="ed-list-tag">' + used + ' 处</span>' +
        '</button>';
      }).join('');

      side.innerHTML =
        '<div class="ed-side-head"><button type="button" class="btn-secondary" data-act="add-ending">+ 结局</button></div>' +
        '<div class="ed-list">' + (rows || '<p class="ed-hint">还没有结局</p>') + '</div>';
      return;
    }

    if (tab === 'check') {
      const result = validateDraft();
      side.innerHTML =
        '<div class="ed-side-head"><button type="button" class="btn-secondary" data-act="recheck">重新校验</button></div>' +
        '<div class="ed-check-summary">' +
          '<div class="ed-check-num error">' + result.errors.length + '<span>错误</span></div>' +
          '<div class="ed-check-num warn">' + result.warnings.length + '<span>提醒</span></div>' +
        '</div>' +
        '<p class="ed-hint">错误会阻止保存和发布；提醒只做提示。</p>';
      return;
    }

    side.innerHTML =
      '<div class="ed-side-head">' +
        '<button type="button" class="btn-secondary" data-act="refresh-versions">刷新版本</button>' +
      '</div>' +
      '<div class="ed-side-info">' +
        '<p>线上版本</p><strong>v' + (meta.version || 0) + '</strong>' +
        '<p>发布时间</p><span>' + stamp(meta.published_at) + '</span>' +
        '<p>发布人</p><span>' + esc(meta.published_by || '—') + '</span>' +
        '<p>草稿更新</p><span>' + stamp(meta.draft_updated_at) + '</span>' +
      '</div>';
  }

  function nodeListHtml() {
    const filter = nodeFilter.trim().toLowerCase();
    const ids = nodeIds().filter(function (id) {
      return !filter || id.toLowerCase().indexOf(filter) !== -1;
    });

    if (!ids.length) return '<p class="ed-hint">没有匹配的节点</p>';

    return ids.map(function (id) {
      const node = draft.nodes[id];
      const tags = [];
      if (id === draft.start) tags.push('<span class="ed-tag start">起点</span>');
      if (node.ending) tags.push('<span class="ed-tag ending">结局</span>');
      return '<button type="button" class="ed-list-item' + (id === selectedNode ? ' active' : '') +
        '" data-node="' + esc(id) + '">' +
        '<span class="ed-list-name">' + esc(id) + '</span>' +
        '<span class="ed-list-tags">' + tags.join('') + '</span>' +
      '</button>';
    }).join('');
  }

  function refreshNodeList() {
    const list = document.getElementById('edNodeList');
    if (list) list.innerHTML = nodeListHtml();
  }

  /* ---------------- 主区域 ---------------- */

  function renderMain() {
    if (tab === 'nodes') renderNodeMain();
    else if (tab === 'scenes') renderSceneMain();
    else if (tab === 'endings') renderEndingMain();
    else if (tab === 'check') renderCheckMain();
    else renderVersionsMain();
  }

  function ensureNodeSelected() {
    if (!selectedNode || !draft.nodes[selectedNode]) selectedNode = nodeIds()[0] || null;
  }

  function renderNodeMain() {
    ensureNodeSelected();
    if (!selectedNode) {
      main.innerHTML = '<p class="ed-hint">剧情还没有节点。点击左侧「+ 节点」开始。</p>';
      return;
    }

    const node = draft.nodes[selectedNode];
    const isEnding = !!node.ending;
    const sceneUrl = draft.scenes[node.scene] || '';

    let html =
      '<div class="ed-form-head">' +
        '<h3>' + esc(selectedNode) + '</h3>' +
        '<div class="ed-form-actions">' +
          '<button type="button" class="btn-secondary" data-act="duplicate-node">复制</button>' +
          '<button type="button" class="btn-secondary danger" data-act="delete-node">删除</button>' +
        '</div>' +
      '</div>' +

      '<section class="ed-section">' +
        '<label class="ed-field">节点 ID' +
          '<div class="ed-inline">' +
            '<input id="edNodeId" class="ed-input" value="' + esc(selectedNode) + '">' +
            '<button type="button" class="btn-secondary" data-act="rename-node">应用</button>' +
          '</div>' +
          '<span class="ed-hint">改名会自动更新所有跳转引用。</span>' +
        '</label>' +

        '<label class="ed-field">场景' +
          '<select class="ed-input" data-nf="scene">' +
            sceneKeys().map(function (key) {
              return '<option value="' + esc(key) + '"' + (key === node.scene ? ' selected' : '') + '>' + esc(key) + '</option>';
            }).join('') +
          '</select>' +
        '</label>' +
        '<div class="ed-scene-preview"><img id="edScenePreview" src="' + esc(sceneUrl) + '" alt=""></div>' +

        '<label class="ed-field">正文' +
          '<textarea id="edNodeText" class="ed-input" rows="10" data-nf="text">' + esc(node.text || '') + '</textarea>' +
          '<span class="ed-hint">用空行分段。</span>' +
        '</label>' +

        '<label class="ed-field">设置旗标 set' +
          '<input class="ed-input" data-nf="set" value="' + esc(flagsToText(node.set)) + '" placeholder="用逗号分隔，例如 hasKey, metGirl">' +
          '<span class="ed-hint">进入该节点时把列出的旗标设为 true。</span>' +
        '</label>' +

        '<label class="ed-check">' +
          '<input type="checkbox" data-act="toggle-ending"' + (isEnding ? ' checked' : '') + '>' +
          '<span>这是结局节点</span>' +
        '</label>' +
      '</section>';

    if (isEnding) {
      const endingIds = draft.endings.map(function (ending) { return ending.id; });
      html +=
        '<section class="ed-section">' +
          '<h4>结局信息</h4>' +
          '<label class="ed-field">结局 ID' +
            '<select class="ed-input" data-nf="endingId">' + optionsHtml(endingIds, node.ending.id) + '</select>' +
          '</label>' +
          '<div class="ed-grid2">' +
            '<label class="ed-field">标题' +
              '<input class="ed-input" data-nf="endingTitle" value="' + esc(node.ending.title || '') + '">' +
            '</label>' +
            '<label class="ed-field">标签' +
              '<input class="ed-input" data-nf="endingTone" value="' + esc(node.ending.tone || '') + '" placeholder="好结局 / 坏结局…">' +
            '</label>' +
          '</div>' +
          '<p class="ed-hint">图鉴里的提示文字在「结局」标签页维护。</p>' +
        '</section>';
    } else {
      html +=
        '<section class="ed-section">' +
          '<div class="ed-form-head"><h4>选项</h4>' +
            '<button type="button" class="btn-secondary" data-act="add-choice">+ 选项</button>' +
          '</div>' +
          '<div class="ed-choices">' +
            (node.choices || []).map(choiceHtml).join('') +
          '</div>' +
          ((node.choices || []).length ? '' : '<p class="ed-hint">非结局节点至少需要一个选项。</p>') +
        '</section>';
    }

    main.innerHTML = html;
  }

  function choiceHtml(choice, index) {
    const isBranch = Array.isArray(choice.next);
    const branchRows = isBranch
      ? choice.next.map(function (branch, branchIndex) {
          return '<div class="ed-branch">' +
            '<label class="ed-field">条件 req' +
              '<input class="ed-input" data-bf="req" data-i="' + index + '" data-bi="' + branchIndex +
              '" value="' + esc(listToText(branch.req)) + '" placeholder="留空 = 默认分支">' +
            '</label>' +
            '<label class="ed-field">跳转到' +
              nodeSelect(branch.next, 'class="ed-input" data-bf="next" data-i="' + index + '" data-bi="' + branchIndex + '"') +
            '</label>' +
            '<button type="button" class="btn-secondary danger" data-act="del-branch" data-i="' + index +
              '" data-bi="' + branchIndex + '">删除分支</button>' +
          '</div>';
        }).join('')
      : '';

    return '<div class="ed-choice">' +
      '<div class="ed-choice-head">' +
        '<strong>选项 ' + (index + 1) + '</strong>' +
        '<button type="button" class="btn-secondary danger" data-act="del-choice" data-i="' + index + '">删除</button>' +
      '</div>' +

      '<label class="ed-field">文字' +
        '<textarea class="ed-input" rows="2" data-cf="text" data-i="' + index + '">' + esc(choice.text || '') + '</textarea>' +
      '</label>' +

      '<div class="ed-grid2">' +
        '<label class="ed-field">跳转方式' +
          '<select class="ed-input" data-act="next-type" data-i="' + index + '">' +
            '<option value="single"' + (isBranch ? '' : ' selected') + '>单节点</option>' +
            '<option value="branch"' + (isBranch ? ' selected' : '') + '>条件分支</option>' +
          '</select>' +
        '</label>' +
        '<label class="ed-field">设置旗标 set' +
          '<input class="ed-input" data-cf="set" data-i="' + index + '" value="' + esc(flagsToText(choice.set)) + '">' +
        '</label>' +
      '</div>' +

      (isBranch
        ? '<div class="ed-branches">' + branchRows +
            '<button type="button" class="btn-secondary" data-act="add-branch" data-i="' + index + '">+ 分支</button>' +
          '</div>'
        : '<label class="ed-field">跳转到' +
            nodeSelect(choice.next, 'class="ed-input" data-cf="next" data-i="' + index + '"') +
          '</label>') +

      '<div class="ed-grid2">' +
        '<label class="ed-field">可用条件 req' +
          '<input class="ed-input" data-cf="req" data-i="' + index + '" value="' + esc(listToText(choice.req)) +
          '" placeholder="不满足则显示为锁定">' +
        '</label>' +
        '<label class="ed-field">显示条件 hideUnless' +
          '<input class="ed-input" data-cf="hideUnless" data-i="' + index + '" value="' + esc(listToText(choice.hideUnless)) +
          '" placeholder="支持 !flag">' +
        '</label>' +
      '</div>' +

      '<label class="ed-field">锁定提示 lock' +
        '<input class="ed-input" data-cf="lock" data-i="' + index + '" value="' + esc(choice.lock || '') + '">' +
      '</label>' +
    '</div>';
  }

  function renderSceneMain() {
    const keys = sceneKeys();
    if (!selectedScene || keys.indexOf(selectedScene) === -1) selectedScene = keys[0] || null;
    if (!selectedScene) {
      main.innerHTML = '<p class="ed-hint">还没有场景。点击左侧「+ 场景」添加。</p>';
      return;
    }

    const url = draft.scenes[selectedScene];
    const used = sceneUsage(selectedScene);

    main.innerHTML =
      '<div class="ed-form-head"><h3>场景 ' + esc(selectedScene) + '</h3>' +
        '<div class="ed-form-actions">' +
          '<button type="button" class="btn-secondary danger" data-act="delete-scene">删除</button>' +
        '</div>' +
      '</div>' +

      '<label class="ed-field">场景键' +
        '<div class="ed-inline">' +
          '<input id="edSceneKey" class="ed-input" value="' + esc(selectedScene) + '">' +
          '<button type="button" class="btn-secondary" data-act="rename-scene">应用</button>' +
        '</div>' +
        '<span class="ed-hint">改名会自动更新所有引用该场景的节点。</span>' +
      '</label>' +

      '<label class="ed-field">图片地址' +
        '<input class="ed-input" data-sf="url" value="' + esc(url) + '" placeholder="/api/images/story/… 或 https://…">' +
      '</label>' +

      '<div class="ed-scene-preview large"><img id="edScenePreview" src="' + esc(url) + '" alt=""></div>' +

      '<div class="ed-upload">' +
        '<label class="btn-secondary upload-label">上传图片' +
          '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-act="upload-scene" hidden>' +
        '</label>' +
        '<span class="ed-hint">支持 JPG / PNG / WebP / GIF，单张不超过 5MB。</span>' +
      '</div>' +

      '<p class="ed-hint">被 ' + used.length + ' 个节点使用' +
        (used.length ? '：' + used.map(esc).join('、') : '') + '</p>';
  }

  function renderEndingMain() {
    if (!draft.endings.length) {
      selectedEnding = null;
      main.innerHTML = '<p class="ed-hint">还没有结局。点击左侧「+ 结局」添加。</p>';
      return;
    }
    if (!selectedEnding || !draft.endings.some(function (item) { return item.id === selectedEnding; })) {
      selectedEnding = draft.endings[0].id;
    }
    const index = draft.endings.findIndex(function (item) { return item.id === selectedEnding; });
    const ending = draft.endings[index];
    const used = endingUsage(ending.id);

    main.innerHTML =
      '<div class="ed-form-head"><h3>结局 ' + esc(ending.title || ending.id) + '</h3>' +
        '<div class="ed-form-actions">' +
          '<button type="button" class="btn-secondary" data-act="move-ending" data-dir="-1">上移</button>' +
          '<button type="button" class="btn-secondary" data-act="move-ending" data-dir="1">下移</button>' +
          '<button type="button" class="btn-secondary danger" data-act="delete-ending">删除</button>' +
        '</div>' +
      '</div>' +

      '<label class="ed-field">结局 ID' +
        '<div class="ed-inline">' +
          '<input id="edEndingId" class="ed-input" value="' + esc(ending.id) + '">' +
          '<button type="button" class="btn-secondary" data-act="rename-ending">应用</button>' +
        '</div>' +
      '</label>' +

      '<label class="ed-field">图鉴标题' +
        '<input class="ed-input" data-ef="title" value="' + esc(ending.title || '') + '">' +
      '</label>' +

      '<label class="ed-field">图鉴提示' +
        '<textarea class="ed-input" rows="3" data-ef="hint">' + esc(ending.hint || '') + '</textarea>' +
      '</label>' +

      '<p class="ed-hint">被 ' + used.length + ' 个节点引用' +
        (used.length ? '：' + used.map(esc).join('、') : '') + '</p>';
  }

  function renderCheckMain() {
    const result = validateDraft();

    function rows(items, kind) {
      if (!items.length) return '<p class="ed-hint">没有' + (kind === 'error' ? '错误' : '提醒') + '。</p>';
      return items.map(function (item) {
        return '<button type="button" class="ed-check-item ' + kind + '" data-act="jump" data-jump-tab="' +
          esc(item.tab || '') + '"' + (item.id ? ' data-jump-id="' + esc(item.id) + '"' : '') + '>' +
          '<span class="ed-check-dot"></span>' + esc(item.msg) +
        '</button>';
      }).join('');
    }

    main.innerHTML =
      '<section class="ed-section"><h3>错误（' + result.errors.length + '）</h3>' +
        rows(result.errors, 'error') + '</section>' +
      '<section class="ed-section"><h3>提醒（' + result.warnings.length + '）</h3>' +
        rows(result.warnings, 'warn') + '</section>';
  }

  async function renderVersionsMain() {
    main.innerHTML = '<p class="ed-hint">加载版本历史…</p>';
    try {
      if (!versionsCache) {
        const data = await window.Game.api('admin/story/versions');
        versionsCache = data.versions || [];
      }
    } catch (err) {
      main.innerHTML = '<p class="ed-hint">加载失败：' + esc(err.message) + '</p>';
      return;
    }

    if (!versionsCache.length) {
      main.innerHTML = '<p class="ed-hint">还没有发布记录。发布草稿后会在这里保留快照。</p>';
      return;
    }

    main.innerHTML = versionsCache.map(function (version) {
      return '<div class="ed-version">' +
        '<div class="ed-version-main">' +
          '<strong>v' + version.version + '</strong>' +
          '<span>' + stamp(version.created_at) + ' · ' + esc(version.created_by || '—') + '</span>' +
          (version.note ? '<p>' + esc(version.note) + '</p>' : '') +
        '</div>' +
        '<button type="button" class="btn-secondary" data-act="restore-version" data-id="' + version.id + '">恢复为草稿</button>' +
      '</div>';
    }).join('');
  }

  /* ---------------- 校验 ---------------- */

  function validateDraft() {
    const errors = [];
    const warnings = [];

    function err(msg, tabName, id) { errors.push({ msg: msg, tab: tabName, id: id }); }
    function warn(msg, tabName, id) { warnings.push({ msg: msg, tab: tabName, id: id }); }

    if (!draft || typeof draft !== 'object') {
      err('剧情数据必须是对象');
      return { errors: errors, warnings: warnings };
    }

    const scenes = draft.scenes || {};
    const nodes = draft.nodes || {};
    const endings = Array.isArray(draft.endings) ? draft.endings : [];
    const ids = Object.keys(nodes);
    const sceneSet = new Set(Object.keys(scenes));

    if (!draft.start) err('缺少起点节点 start');
    if (!nodes[draft.start]) err('起点节点 "' + (draft.start || '') + '" 不存在');
    if (!ids.length) err('剧情至少需要一个节点');
    if (ids.length > 500) err('节点数量超过 500 个上限');

    Object.keys(scenes).forEach(function (key) {
      if (!NODE_ID_RE.test(key)) err('场景键 "' + key + '" 只能包含字母、数字、下划线和短横线', 'scenes', key);
      if (typeof scenes[key] !== 'string' || !scenes[key]) err('场景 "' + key + '" 缺少图片地址', 'scenes', key);
    });

    const endingSet = new Set();
    endings.forEach(function (ending, index) {
      if (!ending || typeof ending !== 'object') {
        err('第 ' + (index + 1) + ' 个结局格式错误', 'endings');
        return;
      }
      if (!ending.id) err('第 ' + (index + 1) + ' 个结局缺少 id', 'endings');
      else if (endingSet.has(ending.id)) err('结局 id "' + ending.id + '" 重复', 'endings', ending.id);
      else endingSet.add(ending.id);
      if (typeof ending.title !== 'string') err('结局 "' + (ending.id || index) + '" 缺少标题', 'endings', ending.id);
      if (ending.hint !== undefined && typeof ending.hint !== 'string') {
        err('结局 "' + (ending.id || index) + '" 的提示必须是文字', 'endings', ending.id);
      }
    });

    const definedFlags = new Set();
    const usedFlags = new Set();

    function collectSet(set) {
      if (set && typeof set === 'object') Object.keys(set).forEach(function (key) { definedFlags.add(key); });
    }

    function checkFlagList(value, label, id) {
      if (value === undefined || value === null) return;
      if (typeof value === 'string') {
        usedFlags.add(value.replace(/^!/, ''));
        return;
      }
      if (!Array.isArray(value) || value.some(function (item) { return typeof item !== 'string'; })) {
        err(label + ' 的旗标条件必须是字符串或数组', 'nodes', id);
        return;
      }
      value.forEach(function (item) { usedFlags.add(item.replace(/^!/, '')); });
    }

    Object.keys(nodes).forEach(function (id) {
      const node = nodes[id];
      const label = '节点 "' + id + '"';

      if (!NODE_ID_RE.test(id)) err(label + ' 的 id 只能包含字母、数字、下划线和短横线', 'nodes', id);
      if (!node || typeof node !== 'object') {
        err(label + ' 格式错误', 'nodes', id);
        return;
      }
      if (typeof node.text !== 'string') err(label + ' 的正文必须是文字', 'nodes', id);
      else if (!node.text.trim()) warn(label + ' 的正文是空的', 'nodes', id);
      if (typeof node.text === 'string' && node.text.length > 20000) err(label + ' 的正文超过 20000 字', 'nodes', id);
      if (!node.scene) err(label + ' 缺少场景', 'nodes', id);
      else if (!sceneSet.has(node.scene)) err(label + ' 引用了不存在的场景 "' + node.scene + '"', 'nodes', id);
      if (node.set !== undefined && (!node.set || typeof node.set !== 'object' || Array.isArray(node.set))) {
        err(label + ' 的 set 必须是对象', 'nodes', id);
      }
      collectSet(node.set);

      if (node.ending) {
        if (!node.ending.id) err(label + ' 的结局缺少 id', 'nodes', id);
        else if (!endingSet.has(node.ending.id)) {
          err(label + ' 引用了结局列表里不存在的结局 "' + node.ending.id + '"', 'nodes', id);
        }
        if (node.ending.title !== undefined && typeof node.ending.title !== 'string') {
          err(label + ' 的结局标题必须是文字', 'nodes', id);
        }
        if (node.ending.tone !== undefined && typeof node.ending.tone !== 'string') {
          err(label + ' 的结局标签必须是文字', 'nodes', id);
        }
        return;
      }

      if (!Array.isArray(node.choices)) {
        err(label + ' 不是结局节点，必须提供 choices 数组', 'nodes', id);
        return;
      }
      if (!node.choices.length) err(label + ' 不是结局节点，至少需要一个选项', 'nodes', id);

      node.choices.forEach(function (choice, index) {
        const choiceLabel = label + ' 的第 ' + (index + 1) + ' 个选项';
        if (!choice || typeof choice !== 'object') {
          err(choiceLabel + ' 格式错误', 'nodes', id);
          return;
        }
        if (typeof choice.text !== 'string') err(choiceLabel + ' 的文字必须是字符串', 'nodes', id);
        else if (!choice.text.trim()) warn(choiceLabel + ' 的文字是空的', 'nodes', id);
        checkFlagList(choice.req, choiceLabel + ' 的 req', id);
        checkFlagList(choice.hideUnless, choiceLabel + ' 的 hideUnless', id);
        if (choice.set !== undefined && (!choice.set || typeof choice.set !== 'object' || Array.isArray(choice.set))) {
          err(choiceLabel + ' 的 set 必须是对象', 'nodes', id);
        }
        collectSet(choice.set);
        if (choice.lock !== undefined && typeof choice.lock !== 'string') {
          err(choiceLabel + ' 的 lock 必须是文字', 'nodes', id);
        }

        if (typeof choice.next === 'string') {
          if (!nodes[choice.next]) err(choiceLabel + ' 跳转到了不存在的节点 "' + choice.next + '"', 'nodes', id);
        } else if (Array.isArray(choice.next)) {
          if (!choice.next.length) err(choiceLabel + ' 的分支数组不能为空', 'nodes', id);
          choice.next.forEach(function (branch, branchIndex) {
            const branchLabel = choiceLabel + ' 分支 ' + (branchIndex + 1);
            if (!branch || typeof branch !== 'object') {
              err(branchLabel + ' 格式错误', 'nodes', id);
              return;
            }
            checkFlagList(branch.req, branchLabel + ' 的 req', id);
            if (typeof branch.next !== 'string' || !nodes[branch.next]) {
              err(branchLabel + ' 跳转到了不存在的节点 "' + branch.next + '"', 'nodes', id);
            }
          });
        } else {
          err(choiceLabel + ' 缺少跳转目标 next', 'nodes', id);
        }
      });
    });

    usedFlags.forEach(function (flag) {
      if (!definedFlags.has(flag)) warn('旗标 "' + flag + '" 被引用，但没有任何节点或选项设置它', 'nodes');
    });

    // 可达性检查
    const reachable = new Set();
    const queue = draft.start ? [draft.start] : [];
    while (queue.length) {
      const id = queue.shift();
      if (reachable.has(id) || !nodes[id]) continue;
      reachable.add(id);
      const node = nodes[id];
      (node.choices || []).forEach(function (choice) {
        if (typeof choice.next === 'string') queue.push(choice.next);
        else if (Array.isArray(choice.next)) {
          choice.next.forEach(function (branch) { if (branch && branch.next) queue.push(branch.next); });
        }
      });
    }
    ids.forEach(function (id) {
      if (!reachable.has(id)) warn('节点 "' + id + '" 从起点无法到达', 'nodes', id);
    });

    endings.forEach(function (ending) {
      if (ending && ending.id && !endingUsage(ending.id).length) {
        warn('结局 "' + (ending.title || ending.id) + '" 还没有任何节点引用', 'endings', ending.id);
      }
    });

    Object.keys(scenes).forEach(function (key) {
      if (!sceneUsage(key).length) warn('场景 "' + key + '" 没有被任何节点使用', 'scenes', key);
    });

    return { errors: errors, warnings: warnings };
  }

  /* ---------------- 保存 / 发布 / 预览 ---------------- */

  async function saveDraft(silent) {
    if (busy) return false;
    const result = validateDraft();
    if (result.errors.length) {
      tab = 'check';
      render();
      toast('有 ' + result.errors.length + ' 个错误，先修正后再保存');
      return false;
    }

    busy = true;
    setStatus('保存草稿…');
    try {
      const res = await window.Game.api('admin/story', {
        method: 'PUT',
        body: JSON.stringify({ story: draft })
      });
      meta.draft_updated_at = res.draft_updated_at;
      meta.draft_updated_by = res.draft_updated_by;
      draftSaved = true;
      dirty = false;
      setStatus('草稿已保存');
      updateDirtyLabel();
      if (!silent) toast('草稿已保存');
      render();
      return true;
    } catch (err) {
      setStatus('保存失败：' + err.message);
      if (!silent) toast('保存失败：' + err.message);
      return false;
    } finally {
      busy = false;
    }
  }

  async function publishDraft() {
    if (busy) return;
    const result = validateDraft();
    if (result.errors.length) {
      tab = 'check';
      render();
      toast('有 ' + result.errors.length + ' 个错误，不能发布');
      return;
    }

    if (!draftSaved || dirty) {
      const saved = await saveDraft(true);
      if (!saved) return;
    }

    if (!confirm('确定把当前草稿发布为线上版本吗？玩家刷新页面后生效。')) return;

    const note = prompt('发布说明（可选，最多 200 字）：', '');
    if (note === null) return;

    busy = true;
    setStatus('发布中…');
    try {
      const res = await window.Game.api('admin/publish', {
        method: 'POST',
        body: JSON.stringify({ note: String(note).slice(0, 200) })
      });
      meta.version = res.version;
      meta.published_at = res.published_at;
      meta.published_by = res.published_by;
      versionsCache = null;
      setStatus('已发布 v' + res.version);
      toast('已发布 v' + res.version);
      window.Game.applyPublishedStory(clone(draft), res.version);
      render();
    } catch (err) {
      setStatus('发布失败：' + err.message);
      toast('发布失败：' + err.message);
    } finally {
      busy = false;
    }
  }

  function previewDraft() {
    const result = validateDraft();
    if (result.errors.length) {
      tab = 'check';
      render();
      toast('有 ' + result.errors.length + ' 个错误，无法试玩');
      return;
    }

    layer.hidden = true;
    document.body.classList.remove('editor-open');
    window.Game.preview(clone(draft), function () {
      layer.hidden = false;
      document.body.classList.add('editor-open');
      render();
    });
  }

  /* ---------------- 结构操作 ---------------- */

  function addNode() {
    const id = uniqueId('node', draft.nodes);
    const scene = sceneKeys()[0] || '';
    draft.nodes[id] = {
      scene: scene,
      text: '',
      choices: [{ text: '继续', next: draft.start || id }]
    };
    selectedNode = id;
    markDirty();
    render();
  }

  function duplicateNode() {
    if (!selectedNode || !draft.nodes[selectedNode]) return;
    const id = uniqueId(selectedNode + '_copy', draft.nodes);
    draft.nodes[id] = clone(draft.nodes[selectedNode]);
    selectedNode = id;
    markDirty();
    render();
  }

  function deleteNode() {
    if (!selectedNode || !draft.nodes[selectedNode]) return;
    if (selectedNode === draft.start) {
      toast('起点节点不能删除，请先把起点换成其他节点');
      return;
    }

    const refs = [];
    Object.keys(draft.nodes).forEach(function (id) {
      (draft.nodes[id].choices || []).forEach(function (choice) {
        if (choice.next === selectedNode) refs.push(id);
        if (Array.isArray(choice.next) && choice.next.some(function (b) { return b.next === selectedNode; })) {
          refs.push(id);
        }
      });
    });

    const tip = refs.length
      ? '该节点被 ' + refs.length + ' 个选项引用，删除后这些跳转会变成空值，需要你重新指定。仍要删除吗？'
      : '确定删除节点「' + selectedNode + '」吗？';
    if (!confirm(tip)) return;

    delete draft.nodes[selectedNode];
    Object.keys(draft.nodes).forEach(function (id) {
      (draft.nodes[id].choices || []).forEach(function (choice) {
        if (choice.next === selectedNode) choice.next = '';
        if (Array.isArray(choice.next)) {
          choice.next.forEach(function (branch) { if (branch.next === selectedNode) branch.next = ''; });
        }
      });
    });

    selectedNode = nodeIds()[0] || null;
    markDirty();
    render();
  }

  function renameNode() {
    const input = document.getElementById('edNodeId');
    if (!input) return;
    const next = input.value.trim();
    const current = selectedNode;

    if (!next) return toast('节点 ID 不能为空');
    if (!NODE_ID_RE.test(next)) return toast('节点 ID 只能包含字母、数字、下划线和短横线');
    if (next === current) return;
    if (draft.nodes[next]) return toast('节点 ID 已存在');

    draft.nodes[next] = draft.nodes[current];
    delete draft.nodes[current];

    if (draft.start === current) draft.start = next;
    Object.keys(draft.nodes).forEach(function (id) {
      (draft.nodes[id].choices || []).forEach(function (choice) {
        if (choice.next === current) choice.next = next;
        if (Array.isArray(choice.next)) {
          choice.next.forEach(function (branch) { if (branch.next === current) branch.next = next; });
        }
      });
    });

    selectedNode = next;
    markDirty();
    render();
  }

  function addScene() {
    const key = uniqueId('scene', draft.scenes);
    draft.scenes[key] = '';
    selectedScene = key;
    markDirty();
    render();
  }

  function renameScene() {
    const input = document.getElementById('edSceneKey');
    if (!input) return;
    const next = input.value.trim();
    const current = selectedScene;

    if (!next) return toast('场景键不能为空');
    if (!NODE_ID_RE.test(next)) return toast('场景键只能包含字母、数字、下划线和短横线');
    if (next === current) return;
    if (draft.scenes[next] !== undefined) return toast('场景键已存在');

    draft.scenes[next] = draft.scenes[current];
    delete draft.scenes[current];
    Object.keys(draft.nodes).forEach(function (id) {
      if (draft.nodes[id].scene === current) draft.nodes[id].scene = next;
    });

    selectedScene = next;
    markDirty();
    render();
  }

  function deleteScene() {
    const used = sceneUsage(selectedScene);
    if (used.length) {
      toast('该场景正被 ' + used.length + ' 个节点使用，先改掉这些节点再删除');
      return;
    }
    if (!confirm('确定删除场景「' + selectedScene + '」吗？')) return;
    delete draft.scenes[selectedScene];
    selectedScene = sceneKeys()[0] || null;
    markDirty();
    render();
  }

  function addEnding() {
    const pool = {};
    draft.endings.forEach(function (ending) { pool[ending.id] = true; });
    const id = uniqueId('end_new', pool);
    draft.endings.push({ id: id, title: '新结局', hint: '' });
    selectedEnding = id;
    markDirty();
    render();
  }

  function renameEnding() {
    const input = document.getElementById('edEndingId');
    if (!input) return;
    const next = input.value.trim();
    const current = selectedEnding;

    if (!next) return toast('结局 ID 不能为空');
    if (!NODE_ID_RE.test(next)) return toast('结局 ID 只能包含字母、数字、下划线和短横线');
    if (next === current) return;
    if (draft.endings.some(function (ending) { return ending.id === next; })) return toast('结局 ID 已存在');

    const ending = draft.endings.find(function (item) { return item.id === current; });
    if (!ending) return;
    ending.id = next;
    Object.keys(draft.nodes).forEach(function (id) {
      const nodeEnding = draft.nodes[id].ending;
      if (nodeEnding && nodeEnding.id === current) nodeEnding.id = next;
    });

    selectedEnding = next;
    markDirty();
    render();
  }

  function deleteEnding() {
    const used = endingUsage(selectedEnding);
    if (used.length) {
      toast('该结局正被 ' + used.length + ' 个节点使用，先改掉这些节点再删除');
      return;
    }
    if (!confirm('确定删除结局「' + selectedEnding + '」吗？')) return;

    draft.endings = draft.endings.filter(function (ending) { return ending.id !== selectedEnding; });
    selectedEnding = draft.endings[0] ? draft.endings[0].id : null;
    markDirty();
    render();
  }

  function moveEnding(direction) {
    const index = draft.endings.findIndex(function (ending) { return ending.id === selectedEnding; });
    const target = index + Number(direction);
    if (index < 0 || target < 0 || target >= draft.endings.length) return;
    const item = draft.endings.splice(index, 1)[0];
    draft.endings.splice(target, 0, item);
    markDirty();
    render();
  }

  async function uploadScene(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    setStatus('上传图片 ' + file.name + '…');
    try {
      const data = await window.Game.uploadImage(file);
      draft.scenes[selectedScene] = data.url;
      markDirty();
      setStatus('图片已上传');
      toast('图片已上传');
      render();
    } catch (err) {
      setStatus('上传失败：' + err.message);
      toast('上传失败：' + err.message);
      input.value = '';
    }
  }

  async function restoreVersion(id) {
    if (!confirm('把该历史版本恢复为草稿？线上版本不会立即变化，确认无误后需要再点发布。')) return;
    busy = true;
    setStatus('恢复版本…');
    try {
      const res = await window.Game.api('admin/rollback', {
        method: 'POST',
        body: JSON.stringify({ id: Number(id) })
      });
      draft = clone(res.story);
      draftSaved = true;
      dirty = true;
      selectedNode = draft.start;
      selectedScene = sceneKeys()[0] || null;
      selectedEnding = draft.endings[0] ? draft.endings[0].id : null;
      tab = 'nodes';
      setStatus('已恢复历史版本为草稿');
      toast('已恢复为草稿，记得发布');
      render();
    } catch (err) {
      setStatus('恢复失败：' + err.message);
      toast('恢复失败：' + err.message);
    } finally {
      busy = false;
    }
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    tabsEl.addEventListener('click', function (event) {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      tab = button.dataset.tab;
      render();
    });

    document.getElementById('edSave').addEventListener('click', function () { saveDraft(false); });
    document.getElementById('edPreview').addEventListener('click', previewDraft);
    document.getElementById('edPublish').addEventListener('click', publishDraft);
    document.getElementById('edClose').addEventListener('click', close);

    side.addEventListener('click', function (event) {
      const node = event.target.closest('[data-node]');
      if (node) {
        selectedNode = node.dataset.node;
        render();
        return;
      }
      const scene = event.target.closest('[data-scene]');
      if (scene) {
        selectedScene = scene.dataset.scene;
        render();
        return;
      }
      const ending = event.target.closest('[data-ending]');
      if (ending) {
        selectedEnding = ending.dataset.ending;
        render();
        return;
      }

      const button = event.target.closest('[data-act]');
      if (!button) return;
      const action = button.dataset.act;

      if (action === 'add-node') addNode();
      else if (action === 'add-scene') addScene();
      else if (action === 'add-ending') addEnding();
      else if (action === 'recheck') render();
      else if (action === 'refresh-versions') {
        versionsCache = null;
        tab = 'versions';
        render();
      }
    });

    side.addEventListener('input', function (event) {
      if (event.target.id === 'edNodeFilter') {
        nodeFilter = event.target.value;
        refreshNodeList();
      }
    });

    side.addEventListener('change', function (event) {
      if (event.target.id === 'edStartSelect') {
        draft.start = event.target.value;
        markDirty();
        render();
      }
    });

    main.addEventListener('input', onMainInput);
    main.addEventListener('change', onMainChange);
    main.addEventListener('click', onMainClick);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && layer && !layer.hidden) close();
    });

    window.addEventListener('beforeunload', function (event) {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  function onMainInput(event) {
    const target = event.target;

    if (target.dataset.nf === 'text') {
      draft.nodes[selectedNode].text = target.value;
      markDirty();
      return;
    }
    if (target.dataset.nf === 'set') {
      draft.nodes[selectedNode].set = parseFlags(target.value);
      markDirty();
      return;
    }
    if (target.dataset.nf === 'endingTitle') {
      draft.nodes[selectedNode].ending.title = target.value;
      markDirty();
      return;
    }
    if (target.dataset.nf === 'endingTone') {
      draft.nodes[selectedNode].ending.tone = target.value;
      markDirty();
      return;
    }

    if (target.dataset.sf === 'url') {
      draft.scenes[selectedScene] = target.value;
      markDirty();
      return;
    }

    if (target.dataset.ef === 'title') {
      const ending = draft.endings.find(function (item) { return item.id === selectedEnding; });
      if (ending) { ending.title = target.value; markDirty(); }
      return;
    }
    if (target.dataset.ef === 'hint') {
      const ending = draft.endings.find(function (item) { return item.id === selectedEnding; });
      if (ending) { ending.hint = target.value; markDirty(); }
      return;
    }

    if (target.dataset.cf) {
      const index = Number(target.dataset.i);
      const choice = ((draft.nodes[selectedNode] || {}).choices || [])[index];
      if (!choice) return;
      const field = target.dataset.cf;
      if (field === 'text') choice.text = target.value;
      else if (field === 'lock') choice.lock = target.value || undefined;
      else if (field === 'set') choice.set = parseFlags(target.value);
      else if (field === 'req') choice.req = parseList(target.value);
      else if (field === 'hideUnless') choice.hideUnless = parseList(target.value);
      else if (field === 'next') choice.next = target.value;
      markDirty();
      return;
    }

    if (target.dataset.bf) {
      const index = Number(target.dataset.i);
      const branchIndex = Number(target.dataset.bi);
      const choice = ((draft.nodes[selectedNode] || {}).choices || [])[index];
      const branch = choice && Array.isArray(choice.next) ? choice.next[branchIndex] : null;
      if (!branch) return;
      if (target.dataset.bf === 'req') branch.req = parseList(target.value);
      else if (target.dataset.bf === 'next') branch.next = target.value;
      markDirty();
    }
  }

  function onMainChange(event) {
    const target = event.target;

    if (target.dataset.nf === 'scene') {
      draft.nodes[selectedNode].scene = target.value;
      markDirty();
      render();
      return;
    }
    if (target.dataset.nf === 'endingId') {
      const ending = draft.endings.find(function (item) { return item.id === target.value; });
      draft.nodes[selectedNode].ending.id = target.value;
      if (ending && !draft.nodes[selectedNode].ending.title) {
        draft.nodes[selectedNode].ending.title = ending.title;
      }
      markDirty();
      return;
    }

    if (target.dataset.sf === 'url') {
      const preview = document.getElementById('edScenePreview');
      if (preview) preview.src = target.value;
      return;
    }

    if (target.dataset.cf === 'next') {
      const index = Number(target.dataset.i);
      const choice = ((draft.nodes[selectedNode] || {}).choices || [])[index];
      if (choice) {
        choice.next = target.value;
        markDirty();
      }
      return;
    }

    if (target.dataset.act === 'next-type') {
      const index = Number(target.dataset.i);
      const choice = draft.nodes[selectedNode].choices[index];
      if (!choice) return;
      if (target.value === 'branch') {
        choice.next = [{ next: typeof choice.next === 'string' ? choice.next : draft.start }];
      } else {
        const first = Array.isArray(choice.next) && choice.next[0] ? choice.next[0].next : draft.start;
        choice.next = first || draft.start;
      }
      markDirty();
      render();
      return;
    }

    if (target.dataset.act === 'toggle-ending') {
      const node = draft.nodes[selectedNode];
      if (target.checked) {
        const ending = draft.endings[0];
        node.ending = {
          id: ending ? ending.id : '',
          title: ending ? ending.title : '新结局',
          tone: '结局'
        };
      } else {
        delete node.ending;
        if (!Array.isArray(node.choices)) node.choices = [];
      }
      markDirty();
      render();
      return;
    }

    if (target.dataset.act === 'upload-scene') {
      uploadScene(target);
      return;
    }

    if (target.dataset.bf === 'next') {
      const index = Number(target.dataset.i);
      const branchIndex = Number(target.dataset.bi);
      const choice = draft.nodes[selectedNode].choices[index];
      if (choice && Array.isArray(choice.next) && choice.next[branchIndex]) {
        choice.next[branchIndex].next = target.value;
        markDirty();
      }
    }
  }

  function onMainClick(event) {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const action = target.dataset.act;
    const index = Number(target.dataset.i);

    if (action === 'rename-node') renameNode();
    else if (action === 'duplicate-node') duplicateNode();
    else if (action === 'delete-node') deleteNode();

    else if (action === 'add-choice') {
      const node = draft.nodes[selectedNode];
      node.choices = node.choices || [];
      node.choices.push({ text: '', next: draft.start });
      markDirty();
      render();
    } else if (action === 'del-choice') {
      draft.nodes[selectedNode].choices.splice(index, 1);
      markDirty();
      render();
    } else if (action === 'add-branch') {
      const choice = draft.nodes[selectedNode].choices[index];
      choice.next.push({ next: draft.start });
      markDirty();
      render();
    } else if (action === 'del-branch') {
      const choice = draft.nodes[selectedNode].choices[index];
      choice.next.splice(Number(target.dataset.bi), 1);
      if (!choice.next.length) choice.next = [{ next: draft.start }];
      markDirty();
      render();
    }

    else if (action === 'rename-scene') renameScene();
    else if (action === 'delete-scene') deleteScene();

    else if (action === 'rename-ending') renameEnding();
    else if (action === 'delete-ending') deleteEnding();
    else if (action === 'move-ending') moveEnding(target.dataset.dir);

    else if (action === 'restore-version') restoreVersion(target.dataset.id);

    else if (action === 'jump') {
      const nextTab = target.dataset.jumpTab;
      const id = target.dataset.jumpId;
      if (nextTab) tab = nextTab;
      if (tab === 'nodes' && id) selectedNode = id;
      if (tab === 'scenes' && id) selectedScene = id;
      if (tab === 'endings' && id) selectedEnding = id;
      render();
    }
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    layer = document.getElementById('editorLayer');
    side = document.getElementById('edSide');
    main = document.getElementById('edMain');
    metaEl = document.getElementById('editorMeta');
    statusEl = document.getElementById('edStatus');
    dirtyEl = document.getElementById('edDirty');
    tabsEl = document.getElementById('edTabs');
    bind();
    updateDirtyLabel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Editor = { open: open, close: close };
})();
