/* 雾亭站 · 剧情编辑器（管理员）
 * 草稿 → 保存 → 发布，支持节点/分支/场景配图/结局/校验/版本恢复
 */
(function () {
  'use strict';

  const NODE_ID_RE = /^[A-Za-z0-9_\-\u4e00-\u9fff]+$/;
  let layer;
  let side;
  let main;
  let metaEl;
  let statusEl;
  let dirtyEl;
  let tabsEl;
  let themeEl;
  let fontEl;

  let draft = null;
  let meta = {};
  let tab = 'nodes';
  let selectedNode = null;
  let selectedScene = null;
  let selectedEnding = null;
  let selectedItemId = null;
  let nodeFilter = '';
  let dirty = false;
  let draftSaved = false;
  let busy = false;
  let versionsCache = null;

  let selectedFlag = null;
  let selectedVar = null;
  let searchQuery = '';
  let searchRan = false;
  let multiSelect = false;
  let selectedIds = new Set();
  let imageCache = null;
  let undoStack = [];
  let redoStack = [];
  let lastTextSnap = 0;

  /* 无头浏览器（Playwright）不提供原生 prompt/confirm，这里包一层 fallback */
  function safePrompt(message, defaultVal) {
    if (typeof window.prompt === 'function') {
      try { return window.safePrompt(message, defaultVal); } catch (_) {}
    }
    return defaultVal == null ? '' : defaultVal;
  }
  function safeConfirm(message) {
    if (typeof window.confirm === 'function') {
      try { return window.safeConfirm(message); } catch (_) {}
    }
    return true;
  }

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

  /* 扫描整份草稿里所有出现过的旗标名：被设置过的 + 被条件引用过的 */
  function collectAllFlags() {
    const set = new Set();
    const add = function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (v) {
        if (typeof v !== 'string') return;
        const k = condName(v);
        if (k) set.add(k);
      });
    };
    (draft && draft.nodes ? Object.keys(draft.nodes) : []).forEach(function (id) {
      const node = draft.nodes[id];
      if (node.set && typeof node.set === 'object') Object.keys(node.set).forEach(function (k) { set.add(k); });
      add(node.req);
      add(node.hideUnless);
      (node.choices || []).forEach(function (c) {
        if (c.set && typeof c.set === 'object') Object.keys(c.set).forEach(function (k) { set.add(k); });
        add(c.req);
        add(c.hideUnless);
        if (Array.isArray(c.next)) c.next.forEach(function (b) { add(b.req); });
      });
    });
    return Array.from(set).sort();
  }

  /* set 类型（对象）转数组，只取真正设为 true 的旗标（数值变更不显示成标签） */
  function setToList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return Object.keys(value).filter(function (k) { return value[k] === true; });
    return [];
  }

  /* 数组转回 set 格式（对象）；保留已有的数值变更项 */
  function listToSet(list, existing) {
    const obj = {};
    if (existing && typeof existing === 'object') {
      Object.keys(existing).forEach(function (k) {
        if (existing[k] !== true) obj[k] = existing[k];
      });
    }
    (list || []).forEach(function (k) { if (typeof k === 'string' && k[0] !== '!') obj[k] = true; });
    return Object.keys(obj).length ? obj : undefined;
  }

  /* 数值变更：对象里的非 true 项 ↔ "金币+1, 好感=3" 文本 */
  function varChangeText(set) {
    if (!set || typeof set !== 'object') return '';
    return Object.keys(set).filter(function (k) { return set[k] !== true; }).map(function (k) {
      const value = set[k];
      return typeof value === 'number' ? k + '=' + value : k + String(value);
    }).join(', ');
  }

  function parseVarChanges(text) {
    const result = {};
    String(text || '').split(/[,，\s]+/).filter(Boolean).forEach(function (pair) {
      let match = pair.match(/^(.+?)([+\-]\d+(?:\.\d+)?)$/);
      if (match) {
        result[match[1]] = match[2];
        return;
      }
      match = pair.match(/^(.+?)=(-?\d+(?:\.\d+)?)$/);
      if (match) result[match[1]] = '=' + match[2];
    });
    return result;
  }

  /* 把数值变更合并进 set，保留原有的 true 旗标 */
  function mergeVarChanges(set, changes) {
    const next = {};
    if (set && typeof set === 'object') {
      Object.keys(set).forEach(function (k) { if (set[k] === true) next[k] = true; });
    }
    Object.keys(changes).forEach(function (k) { next[k] = changes[k]; });
    return Object.keys(next).length ? next : undefined;
  }

  /* 把数组 ['a', '!b'] 渲染成标签组件 */
  function flagPickerHtml(value, attrs) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    const tags = list.map(function (v) {
      const neg = typeof v === 'string' && v[0] === '!';
      const label = neg ? ('非 ' + v.slice(1)) : v;
      return '<span class="ed-fp-tag' + (neg ? ' neg' : '') + '" data-v="' + esc(v) + '">' +
        esc(label) + '<button type="button" class="ed-fp-x" aria-label="删除">×</button></span>';
    }).join('');
    return '<div class="ed-flag-picker" ' + (attrs || '') + '>' +
      '<div class="ed-fp-tags">' + tags +
        '<input type="text" class="ed-fp-input" placeholder="' + (tags ? '继续添加…' : '点击选择旗标…') + '">' +
      '</div>' +
      '<div class="ed-fp-dropdown" hidden></div>' +
    '</div>';
  }

  function renderFlagPickerDropdown(container, known, currentList, query) {
    const drop = container.querySelector('.ed-fp-dropdown');
    const q = String(query || '').trim().toLowerCase();
    const curSet = new Set((currentList || []).map(function (v) { return String(v); }));
    // 过滤掉已选的 + 按 query 过滤
    const pos = known.filter(function (k) {
      if (curSet.has(k)) return false;
      return !q || k.toLowerCase().indexOf(q) !== -1;
    });
    const neg = pos.slice(); // 取反候选同上
    let html = '';
    if (!known.length) {
      html += '<div class="ed-fp-empty">还没有任何旗标可用。先去节点或选项里「设置旗标」。</div>';
    } else if (!pos.length) {
      html += '<div class="ed-fp-empty">全部已选，或者没有匹配。</div>';
    } else {
      html += '<div class="ed-fp-group"><div class="ed-fp-group-title">满足（正向）</div>' +
        pos.map(function (k) { return '<button type="button" class="ed-fp-item" data-v="' + esc(k) + '">' + esc(k) + '</button>'; }).join('') +
      '</div>';
      html += '<div class="ed-fp-group"><div class="ed-fp-group-title">未满足（取反）</div>' +
        neg.map(function (k) { return '<button type="button" class="ed-fp-item neg" data-v="!' + esc(k) + '">非 ' + esc(k) + '</button>'; }).join('') +
      '</div>';
    }
    drop.innerHTML = html;
    drop.hidden = false;
    positionFlagDropdown(container, drop);
  }

  /* 下拉定位：优先向下展开，下方空间不足时向上翻转 */
  function positionFlagDropdown(container, drop) {
    const anchor = container.querySelector('.ed-fp-tags');
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const maxH = 260;
    const width = Math.max(200, Math.min(rect.width, window.innerWidth - 16));
    drop.style.width = width + 'px';
    drop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
    drop.style.maxHeight = maxH + 'px';
    const need = Math.min(drop.scrollHeight || maxH, maxH);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    if (below < need && above > below) {
      const h = Math.min(need, Math.max(120, above));
      drop.style.maxHeight = h + 'px';
      drop.style.top = Math.max(8, rect.top - h - 4) + 'px';
    } else {
      drop.style.maxHeight = Math.min(need, Math.max(120, below)) + 'px';
      drop.style.top = (rect.bottom + 4) + 'px';
    }
  }

  /* 从 picker DOM 读当前值数组 */
  function flagPickerValues(container) {
    if (!container) return undefined;
    const list = Array.from(container.querySelectorAll('.ed-fp-tag')).map(function (tag) {
      return tag.dataset.v;
    });
    return list.length ? list : undefined;
  }

  /* 把旗标值加进 picker DOM（去重，保持顺序），输入框清空 */
  function flagPickerAdd(container, value) {
    const input = container.querySelector('.ed-fp-input');
    const cur = flagPickerValues(container) || [];
    if (!value) return;
    if (cur.indexOf(value) !== -1) { input.value = ''; return; }
    snapshot();
    const neg = value[0] === '!';
    const label = neg ? ('非 ' + value.slice(1)) : value;
    const tag = document.createElement('span');
    tag.className = 'ed-fp-tag' + (neg ? ' neg' : '');
    tag.dataset.v = value;
    tag.innerHTML = esc(label) + '<button type="button" class="ed-fp-x" aria-label="删除">×</button>';
    container.querySelector('.ed-fp-tags').insertBefore(tag, input);
    input.value = '';
    markDirtyFromPicker(container);
  }

  function flagPickerRemove(container, value) {
    if (!value) return;
    snapshot();
    const tag = container.querySelector('.ed-fp-tag[data-v="' + value.replace(/"/g, '\\"') + '"]');
    if (tag) tag.remove();
    markDirtyFromPicker(container);
  }

  /* picker 变化后写回草稿对应字段 */
  function markDirtyFromPicker(container) {
    const i = Number(container.dataset.i);
    if (container.dataset.nfPicker === 'set') {
      // node.set
      const node = draft.nodes[selectedNode];
      if (!node) return;
      node.set = listToSet(flagPickerValues(container), node.set);
      markDirty();
      return;
    }
    if (container.dataset.cfSet !== undefined) {
      // choice.set（没有值，只要属性存在）
      const choice = ((draft.nodes[selectedNode] || {}).choices || [])[i];
      if (!choice) return;
      choice.set = listToSet(flagPickerValues(container), choice.set);
      markDirty();
      return;
    }
    if (container.dataset.cf === 'req' || container.dataset.cf === 'hideUnless') {
      const choice = ((draft.nodes[selectedNode] || {}).choices || [])[i];
      if (!choice) return;
      choice[container.dataset.cf] = flagPickerValues(container);
      markDirty();
      return;
    }
    if (container.dataset.bf === 'req') {
      const bi = Number(container.dataset.bi);
      const choice = draft.nodes[selectedNode].choices[i];
      const branch = choice && Array.isArray(choice.next) ? choice.next[bi] : null;
      if (!branch) return;
      branch.req = flagPickerValues(container);
      markDirty();
    }
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

  /* ---------------- 撤销 / 重做 ---------------- */

  function snapshot() {
    if (!draft) return;
    const json = JSON.stringify(draft);
    if (undoStack.length && undoStack[undoStack.length - 1] === json) {
      redoStack = [];
      return;
    }
    undoStack.push(json);
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }

  function syncSelection() {
    if (!draft || !draft.nodes) return;
    if (!selectedNode || !draft.nodes[selectedNode]) selectedNode = draft.start || nodeIds()[0] || null;
    if (selectedScene && !draft.scenes[selectedScene]) selectedScene = sceneKeys()[0] || null;
    if (selectedEnding && !draft.endings.some(function (e) { return e.id === selectedEnding; })) {
      selectedEnding = draft.endings[0] ? draft.endings[0].id : null;
    }
    const items = Array.isArray(draft.items) ? draft.items : [];
    if (selectedItemId && !items.some(function (i) { return i.id === selectedItemId; })) {
      selectedItemId = items[0] ? items[0].id : null;
    }
    const vars = Array.isArray(draft.vars) ? draft.vars : [];
    if (selectedVar && !vars.some(function (v) { return v.id === selectedVar; })) {
      selectedVar = vars[0] ? vars[0].id : null;
    }
    selectedIds.forEach(function (id) {
      if (!draft.nodes[id]) selectedIds.delete(id);
    });
  }

  function undo() {
    if (!undoStack.length) return toast('没有可撤销的操作');
    redoStack.push(JSON.stringify(draft));
    draft = JSON.parse(undoStack.pop());
    if (!draft.theme) draft.theme = 'amber';
    if (!draft.font) draft.font = 'default';
    syncSelection();
    markDirty();
    render();
    toast('已撤销');
  }

  function redo() {
    if (!redoStack.length) return toast('没有可重做的操作');
    undoStack.push(JSON.stringify(draft));
    draft = JSON.parse(redoStack.pop());
    if (!draft.theme) draft.theme = 'amber';
    if (!draft.font) draft.font = 'default';
    syncSelection();
    markDirty();
    render();
    toast('已重做');
  }

  /* 条件项里取旗标/属性名：支持 "金币 >= 3" 这类数值比较 */
  function condName(cond) {
    const text = String(cond || '').replace(/^!/, '').trim();
    const match = text.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*-?\d+(?:\.\d+)?$/);
    return match ? match[1].trim() : text;
  }

  function isCompareCond(cond) {
    return /^!?\s*.+?\s*(>=|<=|==|!=|>|<)\s*-?\d+(?:\.\d+)?$/.test(String(cond || '').trim());
  }

  function ensureVarsArray() {
    if (!Array.isArray(draft.vars)) draft.vars = [];
    return draft.vars;
  }

  function varNames() {
    return (Array.isArray(draft && draft.vars) ? draft.vars : [])
      .map(function (item) { return item.id; })
      .filter(Boolean)
      .sort();
  }

  function collectPickerNames() {
    const all = collectAllFlags().concat(varNames());
    return Array.from(new Set(all)).sort();
  }

  /* 每个旗标/属性的「设置于」和「被引用」清单 */
  function flagUsage() {
    const map = {};

    function entry(name) {
      if (!map[name]) map[name] = { sets: [], refs: [] };
      return map[name];
    }

    function addSet(set, nodeId, where) {
      if (!set || typeof set !== 'object') return;
      Object.keys(set).forEach(function (key) {
        const value = set[key];
        if (value === true) entry(key).sets.push({ node: nodeId, where: where, kind: 'flag' });
        else entry(key).sets.push({ node: nodeId, where: where, kind: 'var', value: String(value) });
      });
    }

    function addRefs(value, nodeId, where) {
      const list = Array.isArray(value) ? value : (value ? [value] : []);
      list.forEach(function (cond) {
        if (typeof cond !== 'string' || !cond.trim()) return;
        const name = condName(cond);
        if (!name) return;
        entry(name).refs.push({ node: nodeId, where: where, cond: cond });
      });
    }

    Object.keys(draft.nodes).forEach(function (id) {
      const node = draft.nodes[id];
      addSet(node.set, id, '进入节点');
      (node.choices || []).forEach(function (choice, index) {
        const where = '选项 ' + (index + 1);
        addSet(choice.set, id, where);
        addRefs(choice.req, id, where + ' 解锁条件');
        addRefs(choice.hideUnless, id, where + ' 出现条件');
        if (Array.isArray(choice.next)) {
          choice.next.forEach(function (branch, branchIndex) {
            addRefs(branch.req, id, where + ' 分支 ' + (branchIndex + 1));
          });
        }
      });
    });

    return map;
  }

  /* 从起点出发的最短路径（返回 id -> 路径数组） */
  function shortestPaths() {
    const nodes = draft.nodes || {};
    const result = {};
    if (!draft.start || !nodes[draft.start]) return result;

    result[draft.start] = [draft.start];
    const queue = [draft.start];
    while (queue.length) {
      const id = queue.shift();
      const node = nodes[id];
      const nexts = [];
      (node.choices || []).forEach(function (choice) {
        if (typeof choice.next === 'string') nexts.push(choice.next);
        else if (Array.isArray(choice.next)) {
          choice.next.forEach(function (branch) { if (branch && branch.next) nexts.push(branch.next); });
        }
      });
      nexts.forEach(function (next) {
        if (!nodes[next] || result[next]) return;
        result[next] = result[id].concat(next);
        queue.push(next);
      });
    }
    return result;
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
      const data = await window.Game.api('story');
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
      if (!draft.theme) draft.theme = 'amber';
      if (!draft.font) draft.font = 'default';
      selectedScene = sceneKeys()[0] || null;
      selectedEnding = draft.endings[0] ? draft.endings[0].id : null;
      selectedVar = Array.isArray(draft.vars) && draft.vars[0] ? draft.vars[0].id : null;
      selectedItemId = Array.isArray(draft.items) && draft.items[0] ? draft.items[0].id : null;
      nodeFilter = '';
      versionsCache = null;
      imageCache = null;
      undoStack = [];
      redoStack = [];
      lastTextSnap = 0;
      multiSelect = false;
      selectedIds.clear();
      searchQuery = '';
      searchRan = false;
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
    if (dirty && !safeConfirm('草稿有未保存的修改，确定关闭编辑器吗？')) return;
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
    renderTheme();
    renderFont();
    updateDirtyLabel();
  }

  function renderTheme() {
    if (!themeEl || !window.Theme) return;
    themeEl.innerHTML = window.Theme.markup(draft.theme || 'amber', 'data-game-theme');
  }

  function renderFont() {
    if (!fontEl) return;
    const opts = [
      { id: 'default', label: '默认系统' },
      { id: 'serif',   label: '衬线（宋体）' },
      { id: 'sans',    label: '无衬线' },
      { id: 'mono',    label: '等宽' },
      { id: 'hand',    label: '手写' }
    ];
    const cur = (draft && draft.font) || 'default';
    fontEl.innerHTML = opts.map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === cur ? ' selected' : '') + '>' + o.label + '</option>';
    }).join('');
  }

  function renderSide() {
    if (tab === 'nodes' || tab === 'relate') {
      const head = tab === 'nodes'
        ? '<div class="ed-side-head">' +
            '<input id="edNodeFilter" class="ed-input" placeholder="搜索节点…" value="' + esc(nodeFilter) + '">' +
            '<button type="button" class="btn-secondary" data-act="add-node">+ 节点</button>' +
          '</div>' +
          '<div class="ed-side-head">' +
            '<button type="button" class="btn-secondary" data-act="toggle-multi">' +
              (multiSelect ? '退出多选' : '多选') + '</button>' +
            (multiSelect
              ? '<button type="button" class="btn-secondary" data-act="multi-all">全选</button>' +
                '<button type="button" class="btn-secondary" data-act="multi-none">清空</button>'
              : '') +
          '</div>' +
          '<label class="ed-side-label">起点节点</label>' +
          '<select id="edStartSelect" class="ed-input">' + optionsHtml(nodeIds(), draft.start) + '</select>'
        : '<p class="ed-hint">选中节点后，右侧会列出它的出边与入边。</p>';

      side.innerHTML = head + '<div class="ed-list" id="edNodeList">' + nodeListHtml() + '</div>';
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

    if (tab === 'flags') {
      const usage = flagUsage();
      const names = Array.from(new Set(Object.keys(usage).concat(varNames()))).sort();
      if (!selectedFlag || names.indexOf(selectedFlag) === -1) selectedFlag = names[0] || null;

      const rows = names.map(function (name) {
        const rec = usage[name] || { sets: [], refs: [] };
        let badge = '';
        if (usage[name] && !rec.sets.length) badge = '<span class="ed-badge warn">仅引用</span>';
        else if (usage[name] && !rec.refs.length) badge = '<span class="ed-badge">仅设置</span>';
        else if (varNames().indexOf(name) !== -1) badge = '<span class="ed-badge ok">数值</span>';
        return '<button type="button" class="ed-list-item' + (name === selectedFlag ? ' active' : '') +
          '" data-flag="' + esc(name) + '">' +
          '<span class="ed-list-name">' + esc(name) + '</span>' + badge +
        '</button>';
      }).join('');

      side.innerHTML = '<div class="ed-list" style="margin-top:0">' +
        (rows || '<p class="ed-hint">还没有任何旗标。</p>') + '</div>';
      return;
    }

    if (tab === 'search') {
      side.innerHTML =
        '<div class="ed-side-info">' +
          '<p>全局搜索</p><strong>' + (searchRan ? searchCount() + ' 条结果' : '输入关键词') + '</strong>' +
          '<p>范围</p><span>节点正文、选项文字、节点 ID。结果显示上下文，点击可跳到对应节点。</span>' +
        '</div>';
      return;
    }

    if (tab === 'diff') {
      side.innerHTML =
        '<div class="ed-side-info">' +
          '<p>线上版本</p><strong>v' + (meta.version || 0) + '</strong>' +
          '<p>发布时间</p><span>' + stamp(meta.published_at) + '</span>' +
          '<p>说明</p><span>对比当前草稿与线上版本，列出新增、删除和修改过的节点等内容。只做诊断，不会改动数据。</span>' +
        '</div>';
      return;
    }

    if (tab === 'vars') {
      const rows = (Array.isArray(draft.vars) ? draft.vars : []).map(function (item) {
        return '<button type="button" class="ed-list-item' + (item.id === selectedVar ? ' active' : '') +
          '" data-var="' + esc(item.id) + '">' +
          '<span class="ed-list-name">' + esc(item.name || item.id) + '</span>' +
          '<span class="ed-list-tag">' + esc(item.id) + '</span>' +
        '</button>';
      }).join('');
      side.innerHTML =
        '<div class="ed-side-head"><button type="button" class="btn-secondary" data-act="add-var">+ 属性</button></div>' +
        '<div class="ed-list">' + (rows || '<p class="ed-hint">还没有数值属性</p>') + '</div>';
      return;
    }

    if (tab === 'outline') {
      side.innerHTML =
        '<div class="ed-side-info">' +
          '<p>大纲字数</p><strong>' + outlineText().length + ' / 100000</strong>' +
          '<p>说明</p><span>仅作者可见，玩家看不到这里的内容。可自由记录 NPC 设定、情节梳理、结局构思等，自动随草稿保存。</span>' +
        '</div>';
      return;
    }

    if (tab === 'items') {
      side.innerHTML =
        '<div class="ed-side-head"><button type="button" class="btn-secondary" data-act="add-item">+ 物品</button></div>' +
        '<div class="ed-list">' + itemListHtml() + '</div>';
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
      const active = multiSelect ? selectedIds.has(id) : id === selectedNode;
      const check = multiSelect
        ? '<input type="checkbox" class="ed-list-check" tabindex="-1"' + (selectedIds.has(id) ? ' checked' : '') + '>'
        : '';
      return '<button type="button" class="ed-list-item' + (active ? ' active' : '') +
        '" data-node="' + esc(id) + '">' + check +
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
    if (tab === 'nodes') return renderNodeMain();
    if (tab === 'scenes') return renderSceneMain();
    if (tab === 'endings') return renderEndingMain();
    if (tab === 'items') return renderItemsMain();
    if (tab === 'vars') return renderVarsMain();
    if (tab === 'outline') return renderOutlineMain();
    if (tab === 'flags') return renderFlagsMain();
    if (tab === 'relate') return renderRelateMain();
    if (tab === 'search') return renderSearchMain();
    if (tab === 'diff') return renderDiffMain();
    if (tab === 'check') return renderCheckMain();
    renderVersionsMain();
  }

  function ensureNodeSelected() {
    if (!selectedNode || !draft.nodes[selectedNode]) selectedNode = nodeIds()[0] || null;
  }

  function batchBarHtml() {
    if (!multiSelect || !selectedIds.size) return '';
    return '<div class="ed-batch-bar">' +
      '<span>已选 ' + selectedIds.size + ' 个节点</span>' +
      '<select id="edBatchScene" class="ed-input">' +
        '<option value="">选择场景…</option>' + optionsHtml(sceneKeys(), '') +
      '</select>' +
      '<button type="button" class="btn-secondary" data-act="batch-scene">设为该场景</button>' +
      '<button type="button" class="btn-secondary danger" data-act="batch-delete">批量删除</button>' +
      '<button type="button" class="btn-secondary" data-act="batch-clear">取消选择</button>' +
    '</div>';
  }

  function renderNodeMain() {
    ensureNodeSelected();
    const batch = batchBarHtml();
    if (!selectedNode) {
      main.innerHTML = batch + '<p class="ed-hint">剧情还没有节点。点击左侧「+ 节点」开始。</p>';
      return;
    }

    const node = draft.nodes[selectedNode];
    const isEnding = !!node.ending;
    const sceneUrl = draft.scenes[node.scene] || '';

    let html = batch +
      '<div class="ed-form-head">' +
        '<h3>' + esc(selectedNode) + '</h3>' +
        '<div class="ed-form-actions">' +
          '<button type="button" class="btn-secondary" data-act="play-from">从此节点试玩</button>' +
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
          '<div class="ed-toolbar" data-for="text">' +
            '<button type="button" class="ed-tb-btn" data-wrap="**">B</button>' +
            '<button type="button" class="ed-tb-btn" data-wrap="*">I</button>' +
            '<button type="button" class="ed-tb-btn" data-wrap="~~">S</button>' +
            '<span class="ed-tb-sep"></span>' +
            '<button type="button" class="ed-tb-btn" data-tag="accent">亮</button>' +
            '<button type="button" class="ed-tb-btn" data-tag="muted">中</button>' +
            '<button type="button" class="ed-tb-btn" data-tag="faint">淡</button>' +
            '<button type="button" class="ed-tb-btn ed-tb-danger" data-tag="danger">危</button>' +
          '</div>' +
          '<textarea id="edNodeText" class="ed-input" rows="10" data-nf="text">' + esc(node.text || '') + '</textarea>' +
          '<span class="ed-hint">空行分段。支持 **粗体**、*斜体*、~~删除线~~；颜色写 [accent]亮[/] / [muted]中[/] / [faint]淡[/] / [danger]危[/]。</span>' +
        '</label>' +

        '<div class="ed-field">' +
          '<div class="ed-label">进入时设置旗标</div>' +
          flagPickerHtml(setToList(node.set), 'data-nf-picker="set"') +
          '<span class="ed-hint">进入这个节点时，这里列出的旗标会被记为 true，后面的选项可以用它判断是否解锁。下拉里选或打字回车新建。</span>' +
        '</div>' +

        '<label class="ed-field">进入时数值变更' +
          '<input class="ed-input" data-nv="node" value="' + esc(varChangeText(node.set)) + '" placeholder="例如：金币+1, 好感=3, 耐力-2">' +
          '<span class="ed-hint">只对「属性」里定义的数值生效。+1 累加、-2 减少、=3 直接设为 3；条件里可写 金币>=3。</span>' +
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
            '<label class="ed-field">分支条件' +
              flagPickerHtml(branch.req, 'data-bf="req" data-i="' + index + '" data-bi="' + branchIndex + '"') +
              '<span class="ed-fp-tip">留空 = 兜底分支，所有条件都不满足时走这里</span>' +
            '</label>' +
            '<label class="ed-field">跳转到' +
              nodeSelect(branch.next, 'class="ed-input" data-bf="next" data-i="' + index + '" data-bi="' + branchIndex + '"') +
            '</label>' +
            '<button type="button" class="btn-secondary danger" data-act="del-branch" data-i="' + index +
              '" data-bi="' + branchIndex + '">删除分支</button>' +
          '</div>';
        }).join('')
      : '';

    const summaryText = String(choice.text || '').trim().replace(/\s+/g, ' ').slice(0, 40);

    return '<div class="ed-choice" data-i="' + index + '">' +
      '<div class="ed-choice-head">' +
        '<strong>选项 ' + (index + 1) + '</strong>' +
        '<div class="ed-form-actions">' +
          '<button type="button" class="btn-secondary" data-act="move-choice" data-i="' + index + '" data-dir="-1">上移</button>' +
          '<button type="button" class="btn-secondary" data-act="move-choice" data-i="' + index + '" data-dir="1">下移</button>' +
          '<button type="button" class="btn-secondary" data-act="choice-new-node" data-i="' + index + '">新建节点并跳转</button>' +
          '<button type="button" class="btn-secondary danger" data-act="del-choice" data-i="' + index + '">删除</button>' +
          '<button type="button" class="ed-choice-toggle" data-act="toggle-choice" data-i="' + index + '" title="收起/展开选项">' +
            '<span class="caret">▼</span><span class="summary">' + esc(summaryText) + '</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="ed-choice-body">' +
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
          '<div class="ed-field">' +
            '<div class="ed-label">选中时设置旗标</div>' +
            flagPickerHtml(setToList(choice.set), 'data-cf-set data-i="' + index + '"') +
          '</div>' +
        '</div>' +
        '<label class="ed-field">选中时数值变更' +
          '<input class="ed-input" data-nv="choice" data-i="' + index + '" value="' + esc(varChangeText(choice.set)) + '" placeholder="例如：金币+1, 好感-1">' +
        '</label>' +
        (isBranch
          ? '<div class="ed-branches">' + branchRows +
              '<button type="button" class="btn-secondary" data-act="add-branch" data-i="' + index + '">+ 分支</button>' +
            '</div>'
          : '<label class="ed-field">跳转到' +
              nodeSelect(choice.next, 'class="ed-input" data-cf="next" data-i="' + index + '"') +
            '</label>') +
        '<div class="ed-grid2">' +
          '<label class="ed-field">解锁条件' +
            flagPickerHtml(choice.req, 'data-cf="req" data-i="' + index + '"') +
            '<span class="ed-fp-tip">不满足则选项变灰，提示看下方</span>' +
          '</label>' +
          '<label class="ed-field">出现条件' +
            flagPickerHtml(choice.hideUnless, 'data-cf="hideUnless" data-i="' + index + '"') +
            '<span class="ed-fp-tip">不满足则选项直接不显示</span>' +
          '</label>' +
        '</div>' +
        '<label class="ed-field">锁定时提示文字' +
          '<input class="ed-input" data-cf="lock" data-i="' + index + '" value="' + esc(choice.lock || '') + '" placeholder="例如：需要一把钥匙">' +
        '</label>' +
      '</div>' +
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
          '<button type="button" class="btn-secondary" data-act="move-scene" data-dir="-1">上移</button>' +
          '<button type="button" class="btn-secondary" data-act="move-scene" data-dir="1">下移</button>' +
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
        '<span class="ed-hint">支持 JPG / PNG / WebP / GIF，单张不超过 10MB。上传后会直接填到当前场景。</span>' +
      '</div>' +

      '<p class="ed-hint">被 ' + used.length + ' 个节点使用' +
        (used.length ? '：' + used.map(esc).join('、') : '') + '</p>' +
      sceneLibraryHtml();

    loadImages();
  }

  function sceneLibraryHtml() {
    if (!imageCache) return '<section class="ed-section"><h4>已上传的图片</h4><p class="ed-hint">加载中…</p></section>';
    const list = imageCache.slice(0, 60);
    return '<section class="ed-section">' +
      '<div class="ed-form-head"><h4>已上传的图片（' + imageCache.length + '）</h4>' +
        '<button type="button" class="btn-secondary" data-act="refresh-images">刷新</button>' +
      '</div>' +
      (list.length
        ? '<div class="ed-scene-grid">' + list.map(function (image) {
            return '<button type="button" class="ed-scene-card" data-act="use-image" data-url="' + esc(image.url) + '" title="点击用于当前场景">' +
              '<img src="' + esc(image.url) + '" alt="" loading="lazy">' +
              '<span>' + esc(image.name || '') + '</span>' +
            '</button>';
          }).join('') + '</div>' +
          '<p class="ed-hint">点击任意一张图，就会替换当前场景的配图；不会删除原图。</p>'
        : '<p class="ed-hint">还没有上传过图片。</p>') +
    '</section>';
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

  function outlineText() {
    return draft && typeof draft.outline === 'string' ? draft.outline : '';
  }

  function renderOutlineMain() {
    main.innerHTML =
      '<div class="ed-form-head"><h3>大纲与设定</h3></div>' +
      '<textarea id="edOutline" class="ed-input ed-outline" rows="26" placeholder="在这里自由记录：&#10;· NPC 设定（名字、性格、与主角的关系）&#10;· 情节梳理（主线、伏笔、时间线）&#10;· 结局构思（触发条件、达成路径）&#10;&#10;只有你能看到这里的内容，玩家不会读到。"> ' + '' + '</textarea>' +
      '<p class="ed-hint">内容随草稿自动保存，不参与校验和发布。</p>';
    document.getElementById('edOutline').value = outlineText();
  }

  function ensureItemsArray() {
    if (!Array.isArray(draft.items)) draft.items = [];
    return draft.items;
  }

  function itemListHtml() {
    const items = Array.isArray(draft.items) ? draft.items : [];
    if (!items.length) return '<p class="ed-hint">还没有物品。点击左侧「+ 物品」添加。</p>';
    return items.map(function (item, index) {
      return '<button type="button" class="ed-list-item' + (item.id === selectedItemId ? ' active' : '') +
        '" data-item="' + esc(item.id) + '">' +
        '<span class="ed-list-name">' + esc(item.name || item.id) + '</span>' +
        '<span class="ed-list-tag">' + esc(item.id) + '</span>' +
      '</button>';
    }).join('');
  }

  function renderItemsMain() {
    const items = ensureItemsArray();
    if (!items.length) {
      main.innerHTML = '<p class="ed-hint">还没有物品。点击左侧「+ 物品」添加。</p>';
      return;
    }
    if (!selectedItemId || !items.some(function (item) { return item.id === selectedItemId; })) {
      selectedItemId = items[0].id;
    }
    const item = items.find(function (item) { return item.id === selectedItemId; });
    // 该物品对应的旗标被哪些地方设置
    const setters = [];
    Object.keys(draft.nodes).forEach(function (id) {
      const node = draft.nodes[id];
      if (node.set && node.set[item.id]) setters.push('节点 ' + id);
      (node.choices || []).forEach(function (choice, ci) {
        if (choice.set && choice.set[item.id]) setters.push('节点 ' + id + ' 选项 ' + (ci + 1));
      });
    });

    main.innerHTML =
      '<div class="ed-form-head"><h3>物品 ' + esc(item.name || item.id) + '</h3>' +
        '<div class="ed-form-actions">' +
          '<button type="button" class="btn-secondary danger" data-act="delete-item">删除</button>' +
        '</div>' +
      '</div>' +

      '<label class="ed-field">物品 ID（旗标名）' +
        '<div class="ed-inline">' +
          '<input id="edItemId" class="ed-input" value="' + esc(item.id) + '">' +
          '<button type="button" class="btn-secondary" data-act="rename-item">应用</button>' +
        '</div>' +
        '<span class="ed-hint">物品用同名旗标判断是否已获得：在节点或选项的「设置旗标」里选中这个名字，玩家就会在物品栏看到它。</span>' +
      '</label>' +

      '<label class="ed-field">物品名称' +
        '<input class="ed-input" data-itf="name" value="' + esc(item.name || '') + '">' +
      '</label>' +

      '<label class="ed-field">物品说明' +
        '<textarea class="ed-input" rows="3" data-itf="note" placeholder="玩家在物品栏里看到的描述文字">' + esc(item.note || '') + '</textarea>' +
      '</label>' +

      '<p class="ed-hint">设置该旗标的地方：' + (setters.length ? esc(setters.join('、')) : '还没有任何地方设置，玩家不会获得它') + '</p>';
  }

  /* ---------------- 旗标 ---------------- */

  function renderFlagsMain() {
    const usage = flagUsage();
    const names = Array.from(new Set(Object.keys(usage).concat(varNames()))).sort();
    if (!names.length) {
      main.innerHTML = '<p class="ed-hint">还没有任何旗标。在节点或选项的「设置旗标」里新建第一个旗标吧。</p>';
      return;
    }
    if (!selectedFlag || names.indexOf(selectedFlag) === -1) selectedFlag = names[0];

    const rec = usage[selectedFlag] || { sets: [], refs: [] };
    const isVar = varNames().indexOf(selectedFlag) !== -1;

    function usageRows(list, emptyText) {
      if (!list.length) return '<p class="ed-hint">' + emptyText + '</p>';
      return '<div class="ed-usage">' + list.map(function (item) {
        return '<button type="button" class="ed-usage-item" data-act="jump" data-jump-tab="nodes" data-jump-id="' + esc(item.node) + '">' +
          '<span class="ed-usage-where">' + esc(item.where) + '</span>' +
          '<span class="ed-list-name">' + esc(item.node) + '</span>' +
          (item.cond ? '<span class="ed-usage-cond">' + esc(item.cond) + '</span>' : '') +
          (item.value ? '<span class="ed-usage-cond">' + esc(item.value) + '</span>' : '') +
        '</button>';
      }).join('') + '</div>';
    }

    const paths = shortestPaths();
    const endingRows = draft.endings.map(function (ending) {
      const holders = endingUsage(ending.id);
      const body = holders.length
        ? holders.map(function (id) {
            const path = paths[id];
            return '<div class="ed-path">' + (path
              ? '可达：' + path.map(esc).join(' → ')
              : '从起点无法到达节点「' + esc(id) + '」') + '</div>';
          }).join('')
        : '<div class="ed-path">没有任何节点引用这个结局</div>';
      return '<div class="ed-field"><div class="ed-label">' + esc(ending.title || ending.id) + '</div>' + body + '</div>';
    }).join('') || '<p class="ed-hint">还没有定义结局。</p>';

    main.innerHTML =
      '<div class="ed-form-head"><h3>' + esc(selectedFlag) + '</h3>' +
        (isVar ? '<span class="ed-badge ok">数值属性</span>' : '') +
      '</div>' +
      '<div class="ed-diff-summary">' +
        '<span>设置于 <strong>' + rec.sets.length + '</strong> 处</span>' +
        '<span>被引用 <strong>' + rec.refs.length + '</strong> 处</span>' +
        (!rec.sets.length ? '<span class="ed-badge warn">仅引用未设置</span>' : '') +
        (rec.sets.length && !rec.refs.length ? '<span class="ed-badge">仅设置未引用</span>' : '') +
      '</div>' +
      '<section class="ed-section"><h4>设置于</h4>' +
        usageRows(rec.sets, '没有任何地方设置它，条件里引用也不会成立。') + '</section>' +
      '<section class="ed-section"><h4>被引用</h4>' +
        usageRows(rec.refs, '没有被任何条件引用，设置它暂时没有效果。') + '</section>' +
      '<section class="ed-section"><h4>结局路径诊断</h4>' +
        '<p class="ed-hint">按最短路径展示每个结局从起点走过的节点；「无法到达」说明中间断链。</p>' +
        endingRows + '</section>';
  }

  /* ---------------- 关联 ---------------- */

  function renderRelateMain() {
    ensureNodeSelected();
    if (!selectedNode) {
      main.innerHTML = '<p class="ed-hint">剧情还没有节点。</p>';
      return;
    }

    const node = draft.nodes[selectedNode];
    const paths = shortestPaths();

    const outRows = (node.choices || []).map(function (choice, index) {
      const targets = [];
      if (typeof choice.next === 'string') targets.push({ next: choice.next, cond: '' });
      else if (Array.isArray(choice.next)) {
        choice.next.forEach(function (branch) {
          const cond = Array.isArray(branch.req) ? branch.req.join(' 且 ') : (branch.req || '兜底');
          targets.push({ next: branch.next, cond: cond });
        });
      }
      if (!targets.length) targets.push({ next: '', cond: '未设置跳转' });
      return targets.map(function (target) {
        return '<tr><td>选项 ' + (index + 1) + '：' + esc(choice.text || '（空）') + '</td>' +
          '<td class="cond">' + esc(target.cond) + '</td>' +
          '<td>' + (target.next
            ? '<button type="button" class="ed-relate-link" data-act="jump" data-jump-tab="nodes" data-jump-id="' + esc(target.next) + '">' + esc(target.next) + '</button>'
            : '<span class="ed-hint">—</span>') + '</td></tr>';
      }).join('');
    }).join('');

    const inRows = [];
    Object.keys(draft.nodes).forEach(function (id) {
      (draft.nodes[id].choices || []).forEach(function (choice, index) {
        const froms = [];
        if (typeof choice.next === 'string' && choice.next === selectedNode) froms.push('');
        if (Array.isArray(choice.next)) {
          choice.next.forEach(function (branch) {
            if (branch.next === selectedNode) {
              froms.push(Array.isArray(branch.req) ? branch.req.join(' 且 ') : (branch.req || '兜底'));
            }
          });
        }
        froms.forEach(function (cond) {
          inRows.push('<tr><td>' +
            '<button type="button" class="ed-relate-link" data-act="jump" data-jump-tab="nodes" data-jump-id="' + esc(id) + '">' + esc(id) + '</button>' +
            '</td><td>选项 ' + (index + 1) + '：' + esc(choice.text || '（空）') + '</td>' +
            '<td class="cond">' + esc(cond) + '</td></tr>');
        });
      });
    });

    main.innerHTML =
      '<div class="ed-form-head"><h3>关联 · ' + esc(selectedNode) + '</h3></div>' +
      '<div class="ed-diff-summary">' +
        '<span>出边 <strong>' + (node.choices || []).length + '</strong></span>' +
        '<span>入边 <strong>' + inRows.length + '</strong></span>' +
        '<span>可达性 <strong>' + (paths[selectedNode] ? '从起点可达' : '从起点不可达') + '</strong></span>' +
      '</div>' +
      '<section class="ed-section"><h4>出边（这个节点通向哪里）</h4>' +
        (outRows
          ? '<table class="ed-relate-table"><thead><tr><th>选项</th><th>条件</th><th>目标节点</th></tr></thead><tbody>' + outRows + '</tbody></table>'
          : '<p class="ed-hint">这是结局节点，没有出边。</p>') +
      '</section>' +
      '<section class="ed-section"><h4>入边（哪里能到这里）</h4>' +
        (inRows.length
          ? '<table class="ed-relate-table"><thead><tr><th>来源节点</th><th>选项</th><th>条件</th></tr></thead><tbody>' + inRows.join('') + '</tbody></table>'
          : '<p class="ed-hint">没有任何选项指向这里。</p>') +
      '</section>';
  }

  /* ---------------- 全局搜索 ---------------- */

  function searchResults() {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    const results = [];

    Object.keys(draft.nodes).forEach(function (id) {
      const node = draft.nodes[id];
      if (id.toLowerCase().indexOf(query) !== -1) {
        results.push({ node: id, where: '节点 ID', text: id });
      }
      const text = String(node.text || '');
      if (text.toLowerCase().indexOf(query) !== -1) {
        results.push({ node: id, where: '正文', text: text });
      }
      (node.choices || []).forEach(function (choice, index) {
        const choiceText = String(choice.text || '');
        if (choiceText.toLowerCase().indexOf(query) !== -1) {
          results.push({ node: id, where: '选项 ' + (index + 1), text: choiceText });
        }
      });
    });
    return results;
  }

  function searchCount() {
    return searchResults().length;
  }

  function snippetHtml(text, query) {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return esc(text.slice(0, 80));
    const start = Math.max(0, index - 30);
    const end = Math.min(text.length, index + query.length + 50);
    return (start > 0 ? '…' : '') +
      esc(text.slice(start, index)) +
      '<mark>' + esc(text.slice(index, index + query.length)) + '</mark>' +
      esc(text.slice(index + query.length, end)) +
      (end < text.length ? '…' : '');
  }

  function renderSearchMain() {
    const results = searchResults();

    main.innerHTML =
      '<div class="ed-search-box">' +
        '<input id="edSearchInput" class="ed-input" placeholder="搜索正文、选项文字、节点 ID…" value="' + esc(searchQuery) + '">' +
        '<button type="button" class="btn-secondary" data-act="do-search">搜索</button>' +
      '</div>' +
      (!searchQuery.trim()
        ? '<p class="ed-hint">输入关键词后按回车或点「搜索」。</p>'
        : (!results.length
          ? '<p class="ed-hint">没有找到「' + esc(searchQuery) + '」。</p>'
          : results.slice(0, 200).map(function (result) {
              return '<button type="button" class="ed-result" data-act="jump" data-jump-tab="nodes" data-jump-id="' + esc(result.node) + '">' +
                '<span class="ed-result-head"><span>' + esc(result.node) + '</span><span>' + esc(result.where) + '</span></span>' +
                '<span class="ed-result-snippet">' + snippetHtml(result.text, searchQuery.trim()) + '</span>' +
              '</button>';
            }).join('') +
            (results.length > 200 ? '<p class="ed-hint">只显示前 200 条，共 ' + results.length + ' 条。</p>' : '')));
  }

  /* ---------------- 草稿与线上对比 ---------------- */

  function diffStories(published, current) {
    const result = { nodes: [], scenes: [], endings: [], meta: [] };
    if (!published || !published.nodes) return null;

    const pubNodes = published.nodes || {};
    const curNodes = current.nodes || {};
    Object.keys(curNodes).forEach(function (id) {
      if (!pubNodes[id]) {
        result.nodes.push({ id: id, kind: '新增' });
        return;
      }
      const fields = [];
      if (pubNodes[id].text !== curNodes[id].text) fields.push('正文');
      if (pubNodes[id].scene !== curNodes[id].scene) fields.push('场景');
      if (JSON.stringify(pubNodes[id].choices || []) !== JSON.stringify(curNodes[id].choices || [])) fields.push('选项');
      if (JSON.stringify(pubNodes[id].set || null) !== JSON.stringify(curNodes[id].set || null)) fields.push('旗标/数值');
      if (JSON.stringify(pubNodes[id].ending || null) !== JSON.stringify(curNodes[id].ending || null)) fields.push('结局');
      if (fields.length) result.nodes.push({ id: id, kind: '修改', fields: fields });
    });
    Object.keys(pubNodes).forEach(function (id) {
      if (!curNodes[id]) result.nodes.push({ id: id, kind: '删除' });
    });

    const pubScenes = published.scenes || {};
    const curScenes = current.scenes || {};
    Object.keys(curScenes).forEach(function (key) {
      if (!pubScenes[key]) result.scenes.push({ id: key, kind: '新增' });
      else if (pubScenes[key] !== curScenes[key]) result.scenes.push({ id: key, kind: '换图' });
    });
    Object.keys(pubScenes).forEach(function (key) {
      if (!curScenes[key]) result.scenes.push({ id: key, kind: '删除' });
    });

    const pubEndings = new Map((published.endings || []).map(function (e) { return [e.id, e]; }));
    const curEndings = new Map((current.endings || []).map(function (e) { return [e.id, e]; }));
    curEndings.forEach(function (ending, id) {
      if (!pubEndings.has(id)) {
        result.endings.push({ id: id, kind: '新增' });
        return;
      }
      const old = pubEndings.get(id);
      const fields = [];
      if (old.title !== ending.title) fields.push('标题');
      if (old.hint !== ending.hint) fields.push('提示');
      if (fields.length) result.endings.push({ id: id, kind: '修改', fields: fields });
    });
    pubEndings.forEach(function (ending, id) {
      if (!curEndings.has(id)) result.endings.push({ id: id, kind: '删除' });
    });

    if (published.start !== current.start) result.meta.push({ id: '起点节点', kind: published.start + ' → ' + current.start });
    if ((published.theme || 'amber') !== (current.theme || 'amber')) result.meta.push({ id: '配色', kind: '已修改' });
    if ((published.font || 'default') !== (current.font || 'default')) result.meta.push({ id: '字体', kind: '已修改' });
    if (JSON.stringify(published.vars || []) !== JSON.stringify(current.vars || [])) result.meta.push({ id: '数值属性', kind: '已修改' });
    if (JSON.stringify(published.items || []) !== JSON.stringify(current.items || [])) result.meta.push({ id: '物品', kind: '已修改' });

    return result;
  }

  function renderDiffMain() {
    const published = meta.published;
    if (!published) {
      main.innerHTML = '<p class="ed-hint">这款游戏还没有发布过，没有可对比的线上版本。</p>';
      return;
    }

    const diff = diffStories(published, draft);
    const total = diff.nodes.length + diff.scenes.length + diff.endings.length + diff.meta.length;

    if (!total) {
      main.innerHTML = '<p class="ed-hint">草稿与线上 v' + (meta.version || 0) + ' 完全一致，没有待发布的改动。</p>';
      return;
    }

    function group(title, list, withJump) {
      if (!list.length) return '';
      const rows = list.map(function (item) {
        const idHtml = withJump
          ? '<button type="button" class="ed-relate-link" data-act="jump" data-jump-tab="nodes" data-jump-id="' + esc(item.id) + '">' + esc(item.id) + '</button>'
          : '<span>' + esc(item.id) + '</span>';
        return '<div class="ed-diff-row"><span class="ed-diff-id">' + idHtml + '</span>' +
          '<span class="ed-diff-kind">' + esc(item.kind) + '</span>' +
          '<span class="ed-diff-fields">' + esc((item.fields || []).join('、')) + '</span></div>';
      }).join('');
      return '<section class="ed-diff-group"><h4>' + title + '（' + list.length + '）</h4>' + rows + '</section>';
    }

    main.innerHTML =
      '<div class="ed-form-head"><h3>草稿 vs 线上 v' + (meta.version || 0) + '</h3></div>' +
      '<div class="ed-diff-summary">' +
        '<span>节点 <strong>' + diff.nodes.length + '</strong></span>' +
        '<span>场景 <strong>' + diff.scenes.length + '</strong></span>' +
        '<span>结局 <strong>' + diff.endings.length + '</strong></span>' +
        '<span>其他 <strong>' + diff.meta.length + '</strong></span>' +
      '</div>' +
      group('节点', diff.nodes, true) +
      group('场景', diff.scenes, false) +
      group('结局', diff.endings, false) +
      group('其他', diff.meta, false);
  }

  /* ---------------- 数值属性 ---------------- */

  function renderVarsMain() {
    const vars = Array.isArray(draft.vars) ? draft.vars : [];
    if (!vars.length) {
      main.innerHTML = '<p class="ed-hint">还没有数值属性。点击左侧「+ 属性」添加，例如「金币」初始 0。</p>' +
        '<p class="ed-hint">属性可用于条件判断（金币>=3）和数值变更（金币+1）。</p>';
      return;
    }
    if (!selectedVar || !vars.some(function (item) { return item.id === selectedVar; })) {
      selectedVar = vars[0].id;
    }
    const item = vars.find(function (entry) { return entry.id === selectedVar; });

    const setters = [];
    const refs = [];
    Object.keys(draft.nodes).forEach(function (id) {
      const node = draft.nodes[id];
      if (node.set && node.set[item.id] !== undefined && node.set[item.id] !== true) {
        setters.push({ node: id, where: '进入节点', value: String(node.set[item.id]) });
      }
      (node.choices || []).forEach(function (choice, index) {
        if (choice.set && choice.set[item.id] !== undefined && choice.set[item.id] !== true) {
          setters.push({ node: id, where: '选项 ' + (index + 1), value: String(choice.set[item.id]) });
        }
      });
    });
    const usage = flagUsage();
    (usage[item.id] ? usage[item.id].refs : []).forEach(function (ref) { refs.push(ref); });

    main.innerHTML =
      '<div class="ed-form-head"><h3>属性 ' + esc(item.name || item.id) + '</h3>' +
        '<div class="ed-form-actions">' +
          '<button type="button" class="btn-secondary danger" data-act="delete-var">删除</button>' +
        '</div>' +
      '</div>' +
      '<label class="ed-field">属性 ID（条件和变更里用它）' +
        '<div class="ed-inline">' +
          '<input id="edVarId" class="ed-input" value="' + esc(item.id) + '">' +
          '<button type="button" class="btn-secondary" data-act="rename-var">应用</button>' +
        '</div>' +
      '</label>' +
      '<label class="ed-field">显示名称' +
        '<input class="ed-input" data-vf="name" value="' + esc(item.name || '') + '">' +
      '</label>' +
      '<label class="ed-field">初始值' +
        '<input class="ed-input" type="number" data-vf="init" value="' + esc(String(item.init == null ? 0 : item.init)) + '">' +
        '<span class="ed-hint">玩家开局时的数值，默认 0。</span>' +
      '</label>' +
      '<section class="ed-section"><h4>数值变更（' + setters.length + '）</h4>' +
        (setters.length
          ? '<div class="ed-usage">' + setters.map(function (row) {
              return '<button type="button" class="ed-usage-item" data-act="jump" data-jump-tab="nodes" data-jump-id="' + esc(row.node) + '">' +
                '<span class="ed-usage-where">' + esc(row.where) + '</span>' +
                '<span class="ed-list-name">' + esc(row.node) + '</span>' +
                '<span class="ed-usage-cond">' + esc(row.value) + '</span></button>';
            }).join('') + '</div>'
          : '<p class="ed-hint">还没有任何地方修改它。</p>') +
      '</section>' +
      '<section class="ed-section"><h4>条件引用（' + refs.length + '）</h4>' +
        (refs.length
          ? '<div class="ed-usage">' + refs.map(function (row) {
              return '<button type="button" class="ed-usage-item" data-act="jump" data-jump-tab="nodes" data-jump-id="' + esc(row.node) + '">' +
                '<span class="ed-usage-where">' + esc(row.where) + '</span>' +
                '<span class="ed-list-name">' + esc(row.node) + '</span>' +
                '<span class="ed-usage-cond">' + esc(row.cond) + '</span></button>';
            }).join('') + '</div>'
          : '<p class="ed-hint">没有条件用到它。</p>') +
      '</section>';
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
        const data = await window.Game.api('versions');
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
      if (!NODE_ID_RE.test(key)) err('场景键 "' + key + '" 只能包含中文、字母、数字、下划线和短横线', 'scenes', key);
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
    const definedVars = new Set();
    const usedFlags = new Set();

    if (draft.vars !== undefined) {
      if (!Array.isArray(draft.vars)) {
        err('vars 必须是数组', 'vars');
      } else {
        draft.vars.forEach(function (item, index) {
          if (!item || typeof item !== 'object') {
            err('第 ' + (index + 1) + ' 个属性格式错误', 'vars');
            return;
          }
          if (typeof item.id !== 'string' || !item.id) err('第 ' + (index + 1) + ' 个属性缺少 id', 'vars');
          else if (!NODE_ID_RE.test(item.id)) err('属性 id "' + item.id + '" 只能包含中文、字母、数字、下划线和短横线', 'vars');
          else if (definedVars.has(item.id)) err('属性 id "' + item.id + '" 重复', 'vars');
          else definedVars.add(item.id);
          if (item.name !== undefined && typeof item.name !== 'string') err('属性 "' + (item.id || index) + '" 的名称必须是文字', 'vars');
          if (item.init !== undefined && !isFinite(Number(item.init))) err('属性 "' + (item.id || index) + '" 的初始值必须是数字', 'vars');
        });
      }
    }

    function collectSet(set) {
      if (set && typeof set === 'object') {
        Object.keys(set).forEach(function (key) {
          const value = set[key];
          if (value !== true) {
            if (typeof value === 'number') {
              // 直接赋值，属性必须存在
            } else if (typeof value === 'string' && /^[+\-=]\d+(\.\d+)?$/.test(value)) {
              // 相对/绝对变更
            } else {
              err('数值变更 "' + key + '" 的值只能是 true、数字，或 +1 / -1 / =3 形式', 'nodes');
              return;
            }
            if (definedVars.size && !definedVars.has(key)) {
              warn('数值变更 "' + key + '" 没有对应的属性定义', 'vars', key);
            }
          }
          definedFlags.add(key);
        });
      }
    }

    function checkFlagList(value, label, id) {
      if (value === undefined || value === null) return;
      const list = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(list) || list.some(function (item) { return typeof item !== 'string'; })) {
        err(label + ' 的旗标条件必须是字符串或数组', 'nodes', id);
        return;
      }
      list.forEach(function (item) {
        if (!item.trim()) {
          err(label + ' 里有空的条件项', 'nodes', id);
          return;
        }
        usedFlags.add(condName(item));
        if (isCompareCond(item) && definedVars.size && !definedVars.has(condName(item))) {
          warn(label + ' 里的数值条件 "' + item + '" 没有对应的属性定义', 'vars', condName(item));
        }
      });
    }

    Object.keys(nodes).forEach(function (id) {
      const node = nodes[id];
      const label = '节点 "' + id + '"';

      if (!NODE_ID_RE.test(id)) err(label + ' 的 id 只能包含中文、字母、数字、下划线和短横线', 'nodes', id);
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
          err(choiceLabel + ' 缺少跳转目标', 'nodes', id);
        }
      });
    });

    usedFlags.forEach(function (flag) {
      if (!definedFlags.has(flag) && !definedVars.has(flag)) {
        warn('旗标 "' + flag + '" 被引用，但没有任何节点或选项设置它', 'flags', flag);
      }
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
      const res = await window.Game.api('story', {
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

    if (!safeConfirm('确定把当前草稿发布为线上版本吗？玩家刷新页面后生效。')) return;

    const note = safePrompt('发布说明（可选，最多 200 字）：', '');
    if (note === null) return;

    busy = true;
    setStatus('发布中…');
    try {
      const res = await window.Game.api('publish', {
        method: 'POST',
        body: JSON.stringify({ note: String(note).slice(0, 200) })
      });
      meta.version = res.version;
      meta.published_at = res.published_at;
      meta.published_by = res.published_by;
      meta.published = clone(draft);
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

  /* 从当前节点开始试玩，可预设旗标；带调试面板 */
  function playFromNode() {
    if (!selectedNode || !draft.nodes[selectedNode]) return;
    const result = validateDraft();
    if (result.errors.length) {
      tab = 'check';
      render();
      toast('有 ' + result.errors.length + ' 个错误，先修正再试玩');
      return;
    }

    const preset = safePrompt('从「' + selectedNode + '」开始试玩。\n预设旗标（逗号分隔，可留空）：', '');
    if (preset === null) return;

    const flags = {};
    String(preset).split(/[,，\s]+/).filter(Boolean).forEach(function (key) { flags[key] = true; });

    const story = clone(draft);
    story.start = selectedNode;
    layer.hidden = true;
    document.body.classList.remove('editor-open');
    window.Game.preview(story, function () {
      layer.hidden = false;
      document.body.classList.add('editor-open');
      render();
    }, { flags: flags, debug: true, start: selectedNode });
  }

  function choiceNewNode(index) {
    const node = draft.nodes[selectedNode];
    const choice = node && (node.choices || [])[index];
    if (!choice) return;
    if (Array.isArray(choice.next)) return toast('条件分支请先把跳转方式改成「单节点」');

    snapshot();
    const base = String(choice.text || '').trim()
      .replace(/[^\u4e00-\u9fffA-Za-z0-9_\-]/g, '')
      .slice(0, 20) || 'node';
    const id = uniqueId(base, draft.nodes);
    draft.nodes[id] = {
      scene: node.scene || sceneKeys()[0] || '',
      text: '',
      choices: [{ text: '继续', next: draft.start || id }]
    };
    choice.next = id;
    selectedNode = id;
    markDirty();
    render();
    toast('已新建节点「' + id + '」');
  }

  function moveChoice(index, direction) {
    const list = draft.nodes[selectedNode] && draft.nodes[selectedNode].choices;
    if (!Array.isArray(list)) return;
    const target = index + Number(direction);
    if (index < 0 || target < 0 || target >= list.length) return;
    snapshot();
    list.splice(target, 0, list.splice(index, 1)[0]);
    markDirty();
    render();
  }

  function batchSetScene() {
    const select = document.getElementById('edBatchScene');
    const scene = select && select.value;
    if (!scene) return toast('先在左边选择一个场景');
    if (!selectedIds.size) return toast('还没有选中节点');
    snapshot();
    selectedIds.forEach(function (id) {
      if (draft.nodes[id]) draft.nodes[id].scene = scene;
    });
    markDirty();
    render();
    toast('已把 ' + selectedIds.size + ' 个节点设为场景「' + scene + '」');
  }

  function batchDelete() {
    if (!selectedIds.size) return toast('还没有选中节点');
    const ids = Array.from(selectedIds).filter(function (id) { return id !== draft.start && draft.nodes[id]; });
    if (!ids.length) return toast('起点节点不能删除');
    if (!safeConfirm('删除选中的 ' + ids.length + ' 个节点？引用它们的跳转会变成空值，需要重新指定。')) return;

    snapshot();
    ids.forEach(function (id) { delete draft.nodes[id]; });
    Object.keys(draft.nodes).forEach(function (id) {
      (draft.nodes[id].choices || []).forEach(function (choice) {
        if (ids.indexOf(choice.next) !== -1) choice.next = '';
        if (Array.isArray(choice.next)) {
          choice.next.forEach(function (branch) {
            if (ids.indexOf(branch.next) !== -1) branch.next = '';
          });
        }
      });
    });
    selectedIds.clear();
    selectedNode = draft.start;
    markDirty();
    render();
    toast('已删除 ' + ids.length + ' 个节点');
  }

  function addVar() {
    const vars = ensureVarsArray();
    const pool = {};
    vars.forEach(function (item) { pool[item.id] = true; });
    const id = uniqueId('属性', pool);
    vars.push({ id: id, name: '新属性', init: 0 });
    selectedVar = id;
    markDirty();
    render();
  }

  function renameVarInCond(cond, from, to) {
    if (typeof cond !== 'string') return cond;
    const neg = cond.trim().charAt(0) === '!' ? '!' : '';
    const text = cond.trim().replace(/^!/, '').trim();
    const match = text.match(/^(.+?)(\s*(?:>=|<=|==|!=|>|<)\s*-?\d+(?:\.\d+)?)$/);
    if (match && match[1].trim() === from) return neg + to + match[2];
    if (text === from) return neg + to;
    return cond;
  }

  function renameVar() {
    const input = document.getElementById('edVarId');
    if (!input) return;
    const next = input.value.trim();
    const current = selectedVar;
    const vars = ensureVarsArray();

    if (!next) return toast('属性 ID 不能为空');
    if (!NODE_ID_RE.test(next)) return toast('属性 ID 只能包含中文、字母、数字、下划线和短横线');
    if (next === current) return;
    if (vars.some(function (item) { return item.id === next; })) return toast('属性 ID 已存在');

    snapshot();
    vars.forEach(function (item) { if (item.id === current) item.id = next; });

    function renameInList(value) {
      if (Array.isArray(value)) return value.map(function (cond) { return renameVarInCond(cond, current, next); });
      if (typeof value === 'string') return renameVarInCond(value, current, next);
      return value;
    }

    Object.keys(draft.nodes).forEach(function (id) {
      const node = draft.nodes[id];
      if (node.set && node.set[current] !== undefined) {
        node.set[next] = node.set[current];
        delete node.set[current];
      }
      (node.choices || []).forEach(function (choice) {
        if (choice.set && choice.set[current] !== undefined) {
          choice.set[next] = choice.set[current];
          delete choice.set[current];
        }
        if (choice.req !== undefined) choice.req = renameInList(choice.req);
        if (choice.hideUnless !== undefined) choice.hideUnless = renameInList(choice.hideUnless);
        if (Array.isArray(choice.next)) {
          choice.next.forEach(function (branch) {
            if (branch.req !== undefined) branch.req = renameInList(branch.req);
          });
        }
      });
    });

    selectedVar = next;
    markDirty();
    render();
    toast('已重命名，引用也已同步');
  }

  function deleteVar() {
    const vars = ensureVarsArray();
    const item = vars.find(function (entry) { return entry.id === selectedVar; });
    if (!item) return;
    if (!safeConfirm('删除属性「' + (item.name || item.id) + '」？已有节点里的数值变更和条件不会被自动清除，校验会给出提醒。')) return;

    snapshot();
    draft.vars = vars.filter(function (entry) { return entry.id !== selectedVar; });
    selectedVar = draft.vars[0] ? draft.vars[0].id : null;
    markDirty();
    render();
  }

  function addNode() {
    snapshot();
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
    snapshot();
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
    if (!safeConfirm(tip)) return;
    snapshot();

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
    if (!NODE_ID_RE.test(next)) return toast('节点 ID 只能包含中文、字母、数字、下划线和短横线');
    if (next === current) return;
    if (draft.nodes[next]) return toast('节点 ID 已存在');
    snapshot();

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
    snapshot();
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
    if (!NODE_ID_RE.test(next)) return toast('场景键只能包含中文、字母、数字、下划线和短横线');
    if (next === current) return;
    if (draft.scenes[next] !== undefined) return toast('场景键已存在');
    snapshot();

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
    if (!safeConfirm('确定删除场景「' + selectedScene + '」吗？')) return;
    snapshot();
    delete draft.scenes[selectedScene];
    selectedScene = sceneKeys()[0] || null;
    markDirty();
    render();
  }

  function addEnding() {
    snapshot();
    const pool = {};
    draft.endings.forEach(function (ending) { pool[ending.id] = true; });
    const id = uniqueId('end_new', pool);
    draft.endings.push({ id: id, title: '新结局', hint: '' });
    selectedEnding = id;
    markDirty();
    render();
  }

  function addItem() {
    snapshot();
    const items = ensureItemsArray();
    const pool = {};
    items.forEach(function (item) { pool[item.id] = true; });
    const id = uniqueId('item', pool);
    items.push({ id: id, name: '新物品', note: '' });
    selectedItemId = id;
    markDirty();
    render();
  }

  function renameItem() {
    const input = document.getElementById('edItemId');
    if (!input) return;
    const next = input.value.trim();
    const current = selectedItemId;
    const items = Array.isArray(draft.items) ? draft.items : [];

    if (!next) return toast('物品 ID 不能为空');
    if (!NODE_ID_RE.test(next)) return toast('物品 ID 只能包含中文、字母、数字、下划线和短横线');
    if (next === current) return;
    if (items.some(function (item) { return item.id === next; })) return toast('物品 ID 已存在');
    snapshot();

    const item = items.find(function (item) { return item.id === current; });
    if (!item) return;
    item.id = next;
    selectedItemId = next;
    markDirty();
    render();
  }

  function deleteItem() {
    const items = Array.isArray(draft.items) ? draft.items : [];
    const item = items.find(function (item) { return item.id === selectedItemId; });
    if (!item) return;
    if (!safeConfirm('确定删除物品「' + (item.name || item.id) + '」吗？剧情里已设置的旗标不受影响，只是不再显示在物品栏。')) return;
    snapshot();
    draft.items = items.filter(function (item) { return item.id !== selectedItemId; });
    selectedItemId = draft.items[0] ? draft.items[0].id : null;
    markDirty();
    render();
  }

  function renameEnding() {
    const input = document.getElementById('edEndingId');
    if (!input) return;
    const next = input.value.trim();
    const current = selectedEnding;

    if (!next) return toast('结局 ID 不能为空');
    if (!NODE_ID_RE.test(next)) return toast('结局 ID 只能包含中文、字母、数字、下划线和短横线');
    if (next === current) return;
    if (draft.endings.some(function (ending) { return ending.id === next; })) return toast('结局 ID 已存在');
    snapshot();

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
    if (!safeConfirm('确定删除结局「' + selectedEnding + '」吗？')) return;
    snapshot();

    draft.endings = draft.endings.filter(function (ending) { return ending.id !== selectedEnding; });
    selectedEnding = draft.endings[0] ? draft.endings[0].id : null;
    markDirty();
    render();
  }

  function moveEnding(direction) {
    const index = draft.endings.findIndex(function (ending) { return ending.id === selectedEnding; });
    const target = index + Number(direction);
    if (index < 0 || target < 0 || target >= draft.endings.length) return;
    snapshot();
    const item = draft.endings.splice(index, 1)[0];
    draft.endings.splice(target, 0, item);
    markDirty();
    render();
  }

  async function uploadScene(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    snapshot();
    setStatus('上传图片 ' + file.name + '…');
    try {
      const data = await window.Game.uploadImage(file);
      draft.scenes[selectedScene] = data.url;
      imageCache = null;
      markDirty();
      setStatus('图片已上传，可直接用于当前场景');
      toast('图片已上传');
      render();
      loadImages();
    } catch (err) {
      setStatus('上传失败：' + err.message);
      toast('上传失败：' + err.message);
      input.value = '';
    }
  }

  function moveScene(direction) {
    const keys = sceneKeys();
    const index = keys.indexOf(selectedScene);
    const target = index + Number(direction);
    if (index < 0 || target < 0 || target >= keys.length) return;
    snapshot();
    const ordered = keys.slice();
    const item = ordered.splice(index, 1)[0];
    ordered.splice(target, 0, item);
    const next = {};
    ordered.forEach(function (key) { next[key] = draft.scenes[key]; });
    draft.scenes = next;
    markDirty();
    render();
  }

  /* 读取本游戏已经上传过的图片，供场景复用 */
  function loadImages() {
    if (imageCache) return;
    imageCache = [];
    window.Game.api('images').then(function (data) {
      imageCache = Array.isArray(data.images) ? data.images : [];
      if (tab === 'scenes') renderSceneMain();
    }).catch(function () {
      imageCache = [];
    });
  }

  function useImage(url) {
    if (!selectedScene || !url) return;
    snapshot();
    draft.scenes[selectedScene] = url;
    markDirty();
    render();
    toast('已把这张图用于场景「' + selectedScene + '」');
  }

  async function restoreVersion(id) {
    if (!safeConfirm('把该历史版本恢复为草稿？线上版本不会立即变化，确认无误后需要再点发布。')) return;
    busy = true;
    setStatus('恢复版本…');
    try {
      const res = await window.Game.api('rollback', {
        method: 'POST',
        body: JSON.stringify({ id: Number(id) })
      });
      draft = clone(res.story);
      draftSaved = true;
      dirty = true;
      selectedNode = draft.start;
      if (!draft.theme) draft.theme = 'amber';
      if (!draft.font) draft.font = 'default';
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

    layer.addEventListener('click', function (event) {
      const dot = event.target.closest('[data-game-theme]');
      if (!dot || !draft) return;
      draft.theme = dot.dataset.gameTheme;
      markDirty();
      renderTheme();
    });

    if (fontEl) {
      fontEl.addEventListener('change', function () {
        if (!draft) return;
        draft.font = fontEl.value;
        markDirty();
      });
    }

    side.addEventListener('click', function (event) {
      const node = event.target.closest('[data-node]');
      if (node) {
        if (multiSelect && tab === 'nodes') {
          const id = node.dataset.node;
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
          renderSide();
          renderMain();
          return;
        }
        selectedNode = node.dataset.node;
        render();
        return;
      }
      const scene = event.target.closest('[data-scene]');
      if (scene) {
        selectedScene = scene.dataset.scene;
        imageCache = null;
        render();
        return;
      }
      const ending = event.target.closest('[data-ending]');
      if (ending) {
        selectedEnding = ending.dataset.ending;
        render();
        return;
      }
      const item = event.target.closest('[data-item]');
      if (item) {
        selectedItemId = item.dataset.item;
        render();
        return;
      }
      const flag = event.target.closest('[data-flag]');
      if (flag) {
        selectedFlag = flag.dataset.flag;
        render();
        return;
      }
      const variable = event.target.closest('[data-var]');
      if (variable) {
        selectedVar = variable.dataset.var;
        render();
        return;
      }

      const button = event.target.closest('[data-act]');
      if (!button) return;
      const action = button.dataset.act;

      if (action === 'add-node') addNode();
      else if (action === 'add-scene') addScene();
      else if (action === 'add-ending') addEnding();
      else if (action === 'add-item') addItem();
      else if (action === 'add-var') addVar();
      else if (action === 'toggle-multi') {
        multiSelect = !multiSelect;
        if (!multiSelect) selectedIds.clear();
        render();
      } else if (action === 'multi-all') {
        nodeIds().forEach(function (id) { selectedIds.add(id); });
        render();
      } else if (action === 'multi-none') {
        selectedIds.clear();
        render();
      } else if (action === 'recheck') render();
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
        if (event.target.value === draft.start) return;
        snapshot();
        draft.start = event.target.value;
        markDirty();
        render();
      }
    });

    main.addEventListener('input', onMainInput);
    main.addEventListener('change', onMainChange);
    main.addEventListener('click', onMainClick);

    /* ---- 旗标选择器：focus/input/keydown/click-item/click-x ---- */
    function hideAllDropdowns() {
      main.querySelectorAll('.ed-fp-dropdown').forEach(function (d) { d.hidden = true; });
    }
    function openPicker(container, input) {
      hideAllDropdowns();
      const known = collectPickerNames();
      renderFlagPickerDropdown(container, known, flagPickerValues(container), input.value);
    }
    // 滚动/尺寸变化时收起，避免 fixed 下拉与输入框错位
    main.addEventListener('scroll', hideAllDropdowns, true);
    window.addEventListener('resize', hideAllDropdowns);
    main.addEventListener('focusin', function (event) {
      const input = event.target.closest('.ed-fp-input');
      if (!input) return;
      const picker = input.closest('.ed-flag-picker');
      if (!picker) return;
      openPicker(picker, input);
    });
    main.addEventListener('click', function (event) {
      const input = event.target.closest('.ed-fp-input');
      if (!input) return;
      const picker = input.closest('.ed-flag-picker');
      if (!picker) return;
      // 确保聚焦，某些情况下点击不会自动 focus
      if (document.activeElement !== input) input.focus();
      openPicker(picker, input);
    });

    main.addEventListener('input', function (event) {
      const input = event.target.closest('.ed-fp-input');
      if (!input) return;
      const picker = input.closest('.ed-flag-picker');
      if (!picker) return;
      renderFlagPickerDropdown(picker, collectPickerNames(), flagPickerValues(picker), input.value);
    });

    main.addEventListener('keydown', function (event) {
      if (event.target.id === 'edSearchInput' && event.key === 'Enter') {
        event.preventDefault();
        searchRan = true;
        render();
        const input = document.getElementById('edSearchInput');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
        return;
      }
      const input = event.target.closest('.ed-fp-input');
      if (!input) return;
      const picker = input.closest('.ed-flag-picker');
      if (!picker) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        const v = input.value.trim();
        if (v) flagPickerAdd(picker, v);
      } else if (event.key === 'Backspace' && !input.value) {
        // 空输入时退格删最后一个 tag
        const tags = picker.querySelectorAll('.ed-fp-tag');
        if (tags.length) flagPickerRemove(picker, tags[tags.length - 1].dataset.v);
      } else if (event.key === 'Escape') {
        picker.querySelector('.ed-fp-dropdown').hidden = true;
        input.blur();
      }
    });

    // 点击 picker 内部的 item（下拉选项）或 tag 上的 ×
    document.addEventListener('click', function (event) {
      // 点击下拉外关闭
      const anyDrop = event.target.closest('.ed-fp-dropdown');
      const anyPicker = event.target.closest('.ed-flag-picker');
      if (!anyPicker || (anyPicker && anyDrop)) {
        // 点击了下拉项本身，让下面的 main click 处理；否则如果点的是下拉外、也不在 picker 内，全部关
        if (!anyPicker) {
          document.querySelectorAll('.ed-fp-dropdown').forEach(function (d) { d.hidden = true; });
        }
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && layer && !layer.hidden) { close(); return; }
      if (!layer || layer.hidden) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault();
        redo();
      }
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

    if (target.id === 'edSearchInput') {
      searchQuery = target.value;
      return;
    }
    if (target.id === 'edOutline' || target.dataset.nf === 'text' || target.dataset.vf === 'name') {
      // 长文本逐字输入：按 800ms 间隔打一次快照，避免每键一条
      const now = Date.now();
      if (now - lastTextSnap > 800) {
        snapshot();
        lastTextSnap = now;
      }
    }

    if (target.dataset.nv === 'node') {
      const node = draft.nodes[selectedNode];
      if (node) {
        node.set = mergeVarChanges(node.set, parseVarChanges(target.value));
        markDirty();
      }
      return;
    }
    if (target.dataset.nv === 'choice') {
      const choice = ((draft.nodes[selectedNode] || {}).choices || [])[Number(target.dataset.i)];
      if (choice) {
        choice.set = mergeVarChanges(choice.set, parseVarChanges(target.value));
        markDirty();
      }
      return;
    }
    if (target.dataset.vf) {
      const item = ensureVarsArray().find(function (entry) { return entry.id === selectedVar; });
      if (item) {
        if (target.dataset.vf === 'name') item.name = target.value;
        else item.init = Number(target.value) || 0;
        markDirty();
      }
      return;
    }

    if (target.id === 'edOutline') {
      draft.outline = target.value.slice(0, 100000);
      markDirty();
      const count = side.querySelector('.ed-side-info strong');
      if (count) count.textContent = draft.outline.length + ' / 100000';
      return;
    }

    if (target.dataset.nf === 'text') {
      draft.nodes[selectedNode].text = target.value;
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
    if (target.dataset.itf) {
      const items = Array.isArray(draft.items) ? draft.items : [];
      const item = items.find(function (item) { return item.id === selectedItemId; });
      if (item) {
        if (target.dataset.itf === 'name') item.name = target.value;
        else if (target.dataset.itf === 'note') item.note = target.value;
        markDirty();
      }
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
      else if (field === 'next') choice.next = target.value;
      else if (field === 'req' || field === 'hideUnless') {
        choice[field] = flagPickerValues(target.closest('.ed-flag-picker'));
      }
      markDirty();
      return;
    }

    if (target.dataset.bf) {
      const index = Number(target.dataset.i);
      const branchIndex = Number(target.dataset.bi);
      const choice = ((draft.nodes[selectedNode] || {}).choices || [])[index];
      const branch = choice && Array.isArray(choice.next) ? choice.next[branchIndex] : null;
      if (!branch) return;
      if (target.dataset.bf === 'next') branch.next = target.value;
      else if (target.dataset.bf === 'req') branch.req = flagPickerValues(target.closest('.ed-flag-picker'));
      markDirty();
    }
  }

  function onMainChange(event) {
    const target = event.target;

    // 文本类输入在 input 阶段已打过快照，这里不再重复
    const tag = target.tagName;
    const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && (target.type === 'text' || target.type === 'number'));
    if (!typing && target.dataset.sf !== 'url' && target.dataset.act !== 'upload-scene') snapshot();

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
    // 旗标下拉项 → 加到 picker
    const fpItem = event.target.closest('.ed-fp-item');
    if (fpItem) {
      const picker = event.target.closest('.ed-flag-picker');
      if (picker) {
        flagPickerAdd(picker, fpItem.dataset.v);
        picker.querySelector('.ed-fp-input').focus();
        renderFlagPickerDropdown(picker, collectPickerNames(), flagPickerValues(picker), picker.querySelector('.ed-fp-input').value);
      }
      return;
    }

    // tag 上的 × → 从 picker 移除
    const fpX = event.target.closest('.ed-fp-x');
    if (fpX) {
      const picker = event.target.closest('.ed-flag-picker');
      const tag = fpX.closest('.ed-fp-tag');
      if (picker && tag) flagPickerRemove(picker, tag.dataset.v);
      return;
    }

    // 正文工具栏：插入格式占位符
    const tbBtn = event.target.closest('.ed-tb-btn');
    if (tbBtn) {
      const textarea = main.querySelector('#edNodeText');
      if (textarea && selectedNode) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const cur = textarea.value;
        const sel = cur.slice(start, end) || '文字';
        let inserted;
        if (tbBtn.dataset.wrap) {
          const w = tbBtn.dataset.wrap;
          inserted = w + sel + w;
        } else if (tbBtn.dataset.tag) {
          inserted = '[' + tbBtn.dataset.tag + ']' + sel + '[/]';
        }
        if (inserted !== undefined) {
          snapshot();
          textarea.value = cur.slice(0, start) + inserted + cur.slice(end);
          draft.nodes[selectedNode].text = textarea.value;
          markDirty();
          // 光标移到中间
          requestAnimationFrame(function () {
            textarea.focus();
            const m = start + inserted.length - sel.length;
            textarea.setSelectionRange(m, m);
          });
        }
      }
      return;
    }

    const target = event.target.closest('[data-act]');
    if (!target) return;
    const action = target.dataset.act;
    const index = Number(target.dataset.i);

    if (action === 'rename-node') renameNode();
    else if (action === 'duplicate-node') duplicateNode();
    else if (action === 'delete-node') deleteNode();
    else if (action === 'play-from') playFromNode();

    else if (action === 'add-choice') {
      const node = draft.nodes[selectedNode];
      snapshot();
      node.choices = node.choices || [];
      node.choices.push({ text: '', next: draft.start });
      markDirty();
      render();
    } else if (action === 'del-choice') {
      snapshot();
      draft.nodes[selectedNode].choices.splice(index, 1);
      markDirty();
      render();
    } else if (action === 'toggle-choice') {
      const card = target.closest('.ed-choice');
      if (card) card.classList.toggle('collapsed');
    } else if (action === 'move-choice') {
      moveChoice(index, target.dataset.dir);
    } else if (action === 'choice-new-node') {
      choiceNewNode(index);
    } else if (action === 'add-branch') {
      snapshot();
      const choice = draft.nodes[selectedNode].choices[index];
      choice.next.push({ next: draft.start });
      markDirty();
      render();
    } else if (action === 'del-branch') {
      snapshot();
      const choice = draft.nodes[selectedNode].choices[index];
      choice.next.splice(Number(target.dataset.bi), 1);
      if (!choice.next.length) choice.next = [{ next: draft.start }];
      markDirty();
      render();
    }

    else if (action === 'rename-scene') renameScene();
    else if (action === 'delete-scene') deleteScene();
    else if (action === 'move-scene') moveScene(target.dataset.dir);
    else if (action === 'use-image') useImage(target.dataset.url);
    else if (action === 'refresh-images') {
      imageCache = null;
      render();
    }

    else if (action === 'rename-ending') renameEnding();
    else if (action === 'delete-ending') deleteEnding();
    else if (action === 'rename-item') renameItem();
    else if (action === 'delete-item') deleteItem();
    else if (action === 'move-ending') moveEnding(target.dataset.dir);

    else if (action === 'rename-var') renameVar();
    else if (action === 'delete-var') deleteVar();

    else if (action === 'batch-scene') batchSetScene();
    else if (action === 'batch-delete') batchDelete();
    else if (action === 'batch-clear') {
      selectedIds.clear();
      render();
    } else if (action === 'do-search') {
      searchRan = true;
      render();
    }

    else if (action === 'restore-version') restoreVersion(target.dataset.id);

    else if (action === 'jump') {
      const nextTab = target.dataset.jumpTab;
      const id = target.dataset.jumpId;
      if (nextTab) tab = nextTab;
      if (tab === 'nodes' && id) selectedNode = id;
      if (tab === 'scenes' && id) selectedScene = id;
      if (tab === 'endings' && id) selectedEnding = id;
      if (tab === 'flags' && id) selectedFlag = id;
      if (tab === 'vars' && id) selectedVar = id;
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
    themeEl = document.getElementById('edTheme');
    fontEl = document.getElementById('edFont');
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
