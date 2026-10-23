/* 文字冒险引擎 + 本地存档：玩家页与管理员试玩共用
 * 存档结构：{ version, node, flags:{}, endings:[], startedAt }
 */
(function () {
  'use strict';

  const SAVE_VERSION = 1;

  let STORY = null;
  let state = null;
  let saveKey = '';
  let dirty = false;
  let previewing = false;
  let previewBackup = null;
  let previewExitCallback = null;
  let toastTimer = 0;
  let bound = false;

  const gameScreen = document.getElementById('gameScreen');
  const sceneImg = document.getElementById('sceneImg');
  const storyText = document.getElementById('storyText');
  const choicesEl = document.getElementById('choices');
  const endingPanel = document.getElementById('endingPanel');
  const endingTone = document.getElementById('endingTone');
  const endingTitle = document.getElementById('endingTitle');
  const restartBtn = document.getElementById('restartBtn');
  const endingCollectionBtn = document.getElementById('endingCollectionBtn');
  const brandName = document.querySelector('.brand-name');

  const modalLayer = document.getElementById('modalLayer');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');
  const toastEl = document.getElementById('toast');

  const previewBar = document.getElementById('previewBar');
  const previewExit = document.getElementById('previewExit');

  /* ---------------- 工具 ---------------- */

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---- 正文内联格式：**粗体**、*斜体*、~~删除线~~、[颜色]文字[/] ---- */
  function renderInline(raw) {
    let s = escapeHtml(raw || '');
    // 颜色档位
    s = s.replace(/\[accent\]([\s\S]*?)\[\/\]/g, '<span class="story-c-accent">$1</span>');
    s = s.replace(/\[muted\]([\s\S]*?)\[\/\]/g, '<span class="story-c-muted">$1</span>');
    s = s.replace(/\[faint\]([\s\S]*?)\[\/\]/g,  '<span class="story-c-faint">$1</span>');
    s = s.replace(/\[danger\]([\s\S]*?)\[\/\]/g, '<span class="story-c-danger">$1</span>');
    // 删除线、粗体、斜体（注意顺序：先长后短，避免 ** 被 * 吃掉）
    s = s.replace(/~~([\s\S]*?)~~/g, '<del>$1</del>');
    s = s.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([\s\S]*?)\*/g, '<em>$1</em>');
    return s;
  }

  /* ---- 字体：故事级，支持 default/serif/sans/mono/hand ---- */
  function applyFont(fontId) {
    const valid = ['default', 'serif', 'sans', 'mono', 'hand'];
    const id = valid.indexOf(fontId) >= 0 ? fontId : 'default';
    valid.forEach(function (f) {
      if (f !== 'default') storyText.classList.remove('story-f-' + f);
    });
    if (id !== 'default') storyText.classList.add('story-f-' + id);
  }

  function toast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function newState() {
    return {
      version: SAVE_VERSION,
      node: STORY.start,
      flags: {},
      endings: [],
      startedAt: Date.now()
    };
  }

  function migrate(raw) {
    const fresh = newState();
    if (!raw || typeof raw !== 'object') return fresh;

    if (typeof raw.node === 'string' && STORY.nodes[raw.node]) fresh.node = raw.node;
    if (raw.flags && typeof raw.flags === 'object') {
      Object.keys(raw.flags).forEach(function (key) {
        if (raw.flags[key]) fresh.flags[key] = true;
      });
    }
    if (Array.isArray(raw.endings)) {
      raw.endings.forEach(function (id) {
        if (STORY.endings.some(function (e) { return e.id === id; }) && fresh.endings.indexOf(id) === -1) {
          fresh.endings.push(id);
        }
      });
    }
    const started = Number(raw.startedAt);
    if (isFinite(started) && started > 0) fresh.startedAt = started;
    return fresh;
  }

  /* ---------------- 剧情引擎 ---------------- */

  function flagsOk(req) {
    if (!req) return true;
    const list = Array.isArray(req) ? req : [req];
    return list.every(function (flag) {
      if (typeof flag === 'string' && flag.charAt(0) === '!') {
        return !state.flags[flag.slice(1)];
      }
      return !!state.flags[flag];
    });
  }

  function resolveNext(next) {
    if (typeof next === 'string') return next;
    if (Array.isArray(next)) {
      for (let i = 0; i < next.length; i++) {
        const branch = next[i];
        if (!branch.req || flagsOk(branch.req)) return branch.next;
      }
    }
    return null;
  }

  function setScene(sceneKey) {
    const url = STORY.scenes[sceneKey];
    if (!url || sceneImg.dataset.scene === sceneKey) return;
    sceneImg.dataset.scene = sceneKey;
    sceneImg.classList.remove('ready');
    const pre = new Image();
    pre.onload = function () {
      sceneImg.src = url;
      sceneImg.classList.add('ready');
    };
    pre.onerror = function () {
      sceneImg.removeAttribute('src');
    };
    pre.src = url;
  }

  function renderNode(nodeId) {
    const node = STORY.nodes[nodeId];
    if (!node) return;
    state.node = nodeId;
    if (node.set) Object.assign(state.flags, node.set);
    dirty = true;

    setScene(node.scene);
    storyText.innerHTML = String(node.text || '')
      .split(/\n\n+/)
      .map(function (p) { return '<p>' + renderInline(p) + '</p>'; })
      .join('');

    if (node.ending) {
      unlockEnding(node.ending.id);
      choicesEl.hidden = true;
      endingTone.textContent = node.ending.tone || '结局';
      endingTitle.textContent = node.ending.title || '';
      endingPanel.hidden = false;
    } else {
      endingPanel.hidden = true;
      renderChoices(node);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderChoices(node) {
    choicesEl.innerHTML = '';
    (node.choices || []).forEach(function (choice) {
      if (choice.hideUnless && !flagsOk(choice.hideUnless)) return;

      const locked = choice.req && !flagsOk(choice.req);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice' + (locked ? ' locked' : '');
      if (locked) button.disabled = true;

      const text = document.createElement('span');
      text.className = 'choice-text';
      text.textContent = choice.text;
      button.appendChild(text);

      if (locked && choice.lock) {
        const lock = document.createElement('span');
        lock.className = 'choice-lock';
        lock.textContent = choice.lock;
        button.appendChild(lock);
      }

      if (!locked) {
        button.addEventListener('click', function () { choose(choice); });
      }
      choicesEl.appendChild(button);
    });
    choicesEl.hidden = false;
  }

  function choose(choice) {
    if (choice.set) Object.assign(state.flags, choice.set);
    const nextId = resolveNext(choice.next);
    if (!nextId || !STORY.nodes[nextId]) return;
    renderNode(nextId);
    saveNow();
  }

  function unlockEnding(id) {
    if (state.endings.indexOf(id) !== -1) return;
    state.endings.push(id);
    const meta = STORY.endings.find(function (e) { return e.id === id; });
    toast('结局解锁：' + (meta ? meta.title : id));
  }

  function restartRun() {
    state.node = STORY.start;
    state.flags = {};
    renderNode(STORY.start);
    saveNow();
  }

  /* ---------------- 本地存档 ---------------- */

  function saveNow() {
    if (!state || previewing || !saveKey) return;
    try {
      localStorage.setItem(saveKey, JSON.stringify({ state: state }));
      dirty = false;
    } catch (err) {
      // 浏览器禁用本地存储时静默失败，不影响本轮游玩
    }
  }

  function readSaved() {
    if (!saveKey) return null;
    try {
      const raw = JSON.parse(localStorage.getItem(saveKey) || 'null');
      return raw && raw.state ? raw.state : null;
    } catch (err) {
      return null;
    }
  }

  function resetSave() {
    if (!confirm('确定清除全部进度吗？已解锁的结局也会一并清空，无法恢复。')) return;

    state = newState();
    renderNode(STORY.start);
    saveNow();
    closeModal();
    toast('进度已清空');
  }

  /* ---------------- 浮层 ---------------- */

  function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalBody.scrollTop = 0;
    modalLayer.hidden = false;
  }

  function closeModal() {
    modalLayer.hidden = true;
    modalBody.innerHTML = '';
  }

  function openItems() {
    const items = Array.isArray(STORY.items) ? STORY.items : [];
    let html = '<section class="modal-section">';
    if (!items.length) {
      html += '<p class="setting-hint">这个故事没有物品设定。</p>';
    } else {
      let owned = 0;
      const rows = items.map(function (item) {
        const has = state && !!state.flags[item.id];
        if (has) owned++;
        return '<li class="ending-item' + (has ? '' : ' locked') + '">' +
          '<span class="ending-name">' + (has ? escapeHtml(item.name || item.id) : '？？？') + '</span>' +
          '<span class="ending-hint">' + (has ? escapeHtml(item.note || '') : '尚未获得') + '</span>' +
          '</li>';
      }).join('');
      html += '<p class="setting-hint">已获得 ' + owned + ' / ' + items.length + '</p>' +
        '<ul class="ending-list">' + rows + '</ul>';
    }
    openModal('物品栏', html + '</section>');
  }

  function openCollection() {
    const unlocked = state ? state.endings.length : 0;
    let html = '<section class="modal-section">' +
      '<p class="setting-hint">已解锁 ' + unlocked + ' / ' + STORY.endings.length + '</p>' +
      '<ul class="ending-list">';

    STORY.endings.forEach(function (ending) {
      const has = state && state.endings.indexOf(ending.id) !== -1;
      html += '<li class="ending-item' + (has ? '' : ' locked') + '">' +
        '<span class="ending-name">' + (has ? escapeHtml(ending.title) : '？？？') + '</span>' +
        '<span class="ending-hint">' + (has ? '已解锁' : escapeHtml(ending.hint || '')) + '</span>' +
        '</li>';
    });

    openModal('结局图鉴', html + '</ul></section>');
  }

  function openSettings() {
    openModal('设置',
      '<section class="modal-section">' +
        '<h3>进度</h3>' +
        '<p class="setting-hint">「重新开始」清空本轮选择、保留结局图鉴；「清除全部进度」连图鉴一起清空。' +
        (previewing ? '当前为试玩模式，进度不会保存。' : '进度保存在本机浏览器中。') + '</p>' +
        '<button type="button" class="btn-secondary" data-action="restart">重新开始本轮</button>' +
        '<button type="button" class="btn-secondary danger" data-action="reset">清除全部进度</button>' +
      '</section>');
  }

  /* ---------------- 试玩 ---------------- */

  function preview(nextStory, onExit) {
    if (!nextStory || !nextStory.nodes || !nextStory.nodes[nextStory.start]) {
      toast('草稿起点节点无效，无法试玩');
      return;
    }

    bind();

    previewBackup = {
      story: STORY,
      state: state ? JSON.parse(JSON.stringify(state)) : null,
      theme: window.Theme ? window.Theme.current() : 'amber'
    };
    previewing = true;
    previewExitCallback = onExit || null;

    STORY = nextStory;
    state = newState();
    if (window.Theme) window.Theme.set(STORY.theme || 'amber');
    applyFont(STORY.font || 'default');

    previewBar.hidden = false;
    if (brandName && STORY.title) brandName.textContent = STORY.title;
    gameScreen.hidden = false;
    if (modalLayer) modalLayer.hidden = true;
    renderNode(state.node);
    dirty = false;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function endPreview() {
    if (!previewing) return;

    const callback = previewExitCallback;

    previewing = false;
    STORY = previewBackup.story;
    state = previewBackup.state;
    if (window.Theme) window.Theme.set(previewBackup.theme);
    applyFont((STORY && STORY.font) || 'default');
    previewBackup = null;
    previewExitCallback = null;
    previewBar.hidden = true;

    if (state) {
      renderNode(state.node);
    } else {
      gameScreen.hidden = true;
      sceneImg.dataset.scene = '';
    }
    dirty = false;

    if (callback) callback();
  }

  function applyStory(story) {
    if (!story || !story.nodes || !story.nodes[story.start]) return;

    STORY = story;
    if (!state) return;
    if (!STORY.nodes[state.node]) state.node = STORY.start;
    if (Array.isArray(state.endings)) {
      state.endings = state.endings.filter(function (id) {
        return STORY.endings.some(function (ending) { return ending.id === id; });
      });
    }
    renderNode(state.node);
    dirty = false;
  }

  /* ---------------- 启动 ---------------- */

  function bind() {
    if (bound) return;
    bound = true;

    document.querySelectorAll('[data-modal]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.dataset.modal === 'items') openItems();
        else if (button.dataset.modal === 'collection') openCollection();
        else openSettings();
      });
    });

    restartBtn.addEventListener('click', restartRun);
    endingCollectionBtn.addEventListener('click', openCollection);

    modalClose.addEventListener('click', closeModal);
    modalLayer.addEventListener('click', function (event) {
      if (event.target === modalLayer) closeModal();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modalLayer.hidden) closeModal();
    });

    modalBody.addEventListener('click', function (event) {
      const actionBtn = event.target.closest('[data-action]');
      if (!actionBtn) return;
      if (actionBtn.dataset.action === 'restart') {
        restartRun();
        closeModal();
      } else if (actionBtn.dataset.action === 'reset') {
        resetSave();
      }
    });

    previewExit.addEventListener('click', endPreview);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && dirty) saveNow();
    });
    window.addEventListener('pagehide', function () {
      if (dirty) saveNow();
    });
  }

  function boot(story, options) {
    const opts = options || {};
    if (!story || !story.nodes || !story.nodes[story.start]) {
      throw new Error('剧情数据无效');
    }
    bind();
    STORY = story;
    if (window.Theme) window.Theme.set(STORY.theme || 'amber');
    applyFont(STORY.font || 'default');
    saveKey = opts.saveKey || '';
    if (brandName && opts.title) brandName.textContent = opts.title;
    if (opts.title) document.title = opts.title;

    state = migrate(readSaved());
    gameScreen.hidden = false;
    renderNode(state.node);
    dirty = false;
    saveNow();
  }

  window.Engine = {
    boot: boot,
    preview: preview,
    endPreview: endPreview,
    applyStory: applyStory,
    story: function () { return STORY; },
    state: function () { return state; },
    isPreviewing: function () { return previewing; },
    hideGame: function () { gameScreen.hidden = true; },
    showGame: function () { gameScreen.hidden = false; },
    toast: toast,
    closeModal: closeModal
  };
})();
