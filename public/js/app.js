/* 雾亭站 · 文字冒险引擎 + 云端存档
 * 存档结构：{ version, node, flags:{}, endings:[], startedAt }
 */
(function () {
  'use strict';

  const SAVE_VERSION = 1;
  const TOKEN_KEY = 'wuting.cloud.token';
  const GUEST_KEY = 'wuting.guest.save';

  let STORY = window.STORY;

  /* ---------------- DOM ---------------- */

  const authScreen = document.getElementById('authScreen');
  const cloudAuth = document.getElementById('cloudAuth');
  const localAuth = document.getElementById('localAuth');
  const localNotice = document.getElementById('localNotice');
  const authForm = document.getElementById('authForm');
  const authUser = document.getElementById('authUser');
  const authPass = document.getElementById('authPass');
  const authError = document.getElementById('authError');
  const authSubmit = document.getElementById('authSubmit');
  const guestBtn = document.getElementById('guestBtn');
  const cloudGuestBtn = document.getElementById('cloudGuestBtn');

  const gameScreen = document.getElementById('gameScreen');
  const userTag = document.getElementById('userTag');
  const sceneImg = document.getElementById('sceneImg');
  const storyText = document.getElementById('storyText');
  const choicesEl = document.getElementById('choices');
  const endingPanel = document.getElementById('endingPanel');
  const endingTone = document.getElementById('endingTone');
  const endingTitle = document.getElementById('endingTitle');
  const restartBtn = document.getElementById('restartBtn');
  const endingCollectionBtn = document.getElementById('endingCollectionBtn');

  const modalLayer = document.getElementById('modalLayer');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');
  const toastEl = document.getElementById('toast');

  const previewBar = document.getElementById('previewBar');
  const previewExit = document.getElementById('previewExit');

  /* ---------------- 状态 ---------------- */

  let state = null;
  let mode = 'guest';
  let cloudName = '';
  let cloudRole = 'player';
  let authMode = 'login';
  let dirty = false;
  let saveChain = Promise.resolve();
  let toastTimer = 0;
  let storyVersion = 0;
  let storySource = 'builtin';
  let previewing = false;
  let previewBackup = null;
  let previewExitCallback = null;

  /* ---------------- 云端账号（Cloudflare Pages Functions + D1） ---------------- */

  const Cloud = {
    token: null,
    role: 'player',

    // 探测当前环境是否有云后端（本地 python 静态服务时无 /api，自动降级为本地试玩）
    async detect() {
      try {
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, 5000);
        const res = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
      } catch (err) {
        return false;
      }
    },

    async api(path, options) {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers.Authorization = 'Bearer ' + this.token;

      const res = await fetch('/api/' + path, Object.assign({}, options, { headers: headers }));
      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        // 忽略解析错误，下面统一处理
      }
      if (!res.ok) {
        const err = new Error(data.error || ('请求失败 (' + res.status + ')'));
        err.status = res.status;
        throw err;
      }
      return data;
    },

    setToken(token) {
      this.token = token;
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    },

    async register(username, password) {
      const data = await this.api('register', {
        method: 'POST',
        body: JSON.stringify({ username: username, password: password })
      });
      this.setToken(data.token);
      this.role = data.role || 'player';
      return data.username;
    },

    async login(username, password) {
      const data = await this.api('login', {
        method: 'POST',
        body: JSON.stringify({ username: username, password: password })
      });
      this.setToken(data.token);
      this.role = data.role || 'player';
      return data.username;
    },

    async loadGame() {
      const data = await this.api('load', { method: 'GET' });
      this.role = data.role || 'player';
      return data;
    },

    async uploadImage(file) {
      const headers = {};
      if (this.token) headers.Authorization = 'Bearer ' + this.token;

      const form = new FormData();
      form.append('file', file);

      const res = await fetch('/api/admin/images', { method: 'POST', headers: headers, body: form });
      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        // 保持下面统一处理
      }
      if (!res.ok) {
        const error = new Error(data.error || ('上传失败 (' + res.status + ')'));
        error.status = res.status;
        throw error;
      }
      return data;
    },

    async saveGame(save) {
      return this.api('save', {
        method: 'POST',
        body: JSON.stringify({ save: save })
      });
    },

    async logout() {
      try {
        await this.api('logout', { method: 'POST', body: '{}' });
      } catch (err) {
        console.error(err);
      }
      this.setToken(null);
    }
  };

  /* ---------------- 工具 ---------------- */

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  // req / hideUnless 条件求值，支持 '!flag' 取反
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

  // next 可以是字符串，或按顺序求值的分支数组 [{ req, next }]
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
      .map(function (p) { return '<p>' + escapeHtml(p) + '</p>'; })
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
      button.disabled = locked;

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
    saveNow(false);
  }

  function unlockEnding(id) {
    if (state.endings.indexOf(id) !== -1) return;
    state.endings.push(id);
    const meta = STORY.endings.find(function (e) { return e.id === id; });
    toast('结局解锁：' + (meta ? meta.title : id));
  }

  // 重新开始本轮：清空旗标回到起点，保留已解锁结局
  function restartRun() {
    state.node = STORY.start;
    state.flags = {};
    renderNode(STORY.start);
    saveNow(false);
  }

  /* ---------------- 存档 ---------------- */

  function saveGuestNow() {
    localStorage.setItem(GUEST_KEY, JSON.stringify({ state: state }));
  }

  function saveNow(feedback) {
    if (!state || previewing) return Promise.resolve();
    saveChain = saveChain.then(function () { return doSave(feedback); });
    return saveChain;
  }

  async function doSave(feedback) {
    if (!state) return;

    dirty = false;
    const snapshot = JSON.parse(JSON.stringify(state));

    try {
      if (mode === 'cloud') {
        await Cloud.saveGame(snapshot);
      } else {
        saveGuestNow();
      }
      if (feedback) toast('已保存');
    } catch (err) {
      dirty = true;
      console.error('保存失败', err);
      if (feedback) toast('保存失败：' + ((err && err.message) || '网络错误'));
    }
  }

  async function resetSave() {
    if (!confirm('确定清除全部进度吗？已解锁的结局也会一并清空，无法恢复。')) return;

    state = newState();
    dirty = true;
    renderNode(STORY.start);
    await saveNow(false);
    closeModal();
    toast('进度已清空');
  }

  async function logoutCloud() {
    if (mode !== 'cloud') return;
    if (!confirm('确定退出当前云端账号吗？')) return;

    await saveNow(false);
    await Cloud.logout();
    location.reload();
  }

  function enterGuest() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
    } catch (err) {
      saved = null;
    }

    const loadedState = saved && saved.state ? migrate(saved.state) : newState();
    beginGame(loadedState, 'guest', '本地玩家');
  }

  async function enterCloud(username, role) {
    const row = await Cloud.loadGame();
    const realRole = (row && row.role) || role || 'player';

    if (row && row.save && Object.keys(row.save).length > 0) {
      beginGame(migrate(row.save), 'cloud', username, realRole);
      return;
    }

    const initial = newState();
    await Cloud.saveGame(initial);
    beginGame(initial, 'cloud', username, realRole);
  }

  function beginGame(initialState, nextMode, name, role) {
    state = migrate(initialState);
    mode = nextMode;
    cloudName = name;
    cloudRole = role || 'player';

    authScreen.hidden = true;
    gameScreen.hidden = false;
    userTag.textContent = mode === 'cloud'
      ? name + (cloudRole === 'admin' ? ' · 管理员' : '')
      : '本地试玩';

    renderNode(state.node);
    dirty = false;
    if (mode === 'guest') saveGuestNow();
  }

  /* ---------------- 浮层 ---------------- */

  function openModal(name) {
    modalLayer.hidden = false;
    if (name === 'collection') renderCollection();
    else if (name === 'settings') renderSettings();
  }

  function closeModal() {
    modalLayer.hidden = true;
    modalBody.innerHTML = '';
  }

  function renderCollection() {
    modalTitle.textContent = '结局图鉴';
    const unlocked = state ? state.endings.length : 0;
    let html = '<section class="modal-section">' +
      '<p class="setting-hint">已解锁 ' + unlocked + ' / ' + STORY.endings.length + '</p>' +
      '<ul class="ending-list">';

    STORY.endings.forEach(function (ending) {
      const has = state && state.endings.indexOf(ending.id) !== -1;
      html += '<li class="ending-item' + (has ? '' : ' locked') + '">' +
        '<span class="ending-name">' + (has ? escapeHtml(ending.title) : '？？？') + '</span>' +
        '<span class="ending-hint">' + (has ? '已解锁' : escapeHtml(ending.hint)) + '</span>' +
      '</li>';
    });

    modalBody.innerHTML = html + '</ul></section>';
    modalBody.scrollTop = 0;
  }

  function renderSettings() {
    modalTitle.textContent = '设置';
    const isCloud = mode === 'cloud';
    modalBody.innerHTML =
      '<section class="modal-section">' +
        '<h3>账号</h3>' +
        '<div class="setting-row"><span>模式</span><span>' + (isCloud ? '云端账号' : '本地试玩') + '</span></div>' +
        '<div class="setting-row"><span>账号名</span><span>' + escapeHtml(isCloud ? cloudName : '本地玩家') + '</span></div>' +
        '<div class="setting-row"><span>权限</span><span>' + (cloudRole === 'admin' ? '管理员' : '玩家') + '</span></div>' +
      '</section>' +
      '<section class="modal-section">' +
        '<h3>进度</h3>' +
        '<p class="setting-hint">「重新开始」清空本轮选择、保留结局图鉴；「清除全部进度」连图鉴一起清空。</p>' +
        '<button type="button" class="btn-secondary" data-action="restart">重新开始本轮</button>' +
        '<button type="button" class="btn-secondary danger" data-action="reset">清除全部进度</button>' +
        (isCloud ? '<button type="button" class="btn-secondary" id="logoutBtn">退出登录</button>' : '') +
      '</section>' +
      '<section class="modal-section">' +
        '<h3>剧情内容</h3>' +
        '<div class="setting-row"><span>来源</span><span>' +
          (storySource === 'cloud' ? '云端 v' + storyVersion : '内置剧情') +
        '</span></div>' +
        (cloudRole === 'admin'
          ? '<p class="setting-hint">你是管理员，可以直接编辑剧情、上传配图并发布。</p>' +
            '<button type="button" class="btn-secondary" data-action="editor">打开剧情编辑器</button>'
          : '<p class="setting-hint">剧情由管理员维护。</p>') +
      '</section>';
    modalBody.scrollTop = 0;
  }

  /* ---------------- 账号界面 ---------------- */

  function showCloudAuth() {
    cloudAuth.hidden = false;
    localAuth.hidden = true;
  }

  function showLocalAuth(note) {
    cloudAuth.hidden = true;
    localAuth.hidden = false;
    if (note) localNotice.textContent = note;
  }

  function setAuthMode(nextMode) {
    authMode = nextMode;
    document.querySelectorAll('.auth-tab').forEach(function (tab) {
      const active = tab.dataset.tab === nextMode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    authSubmit.textContent = nextMode === 'register' ? '注册' : '登录';
    authPass.autocomplete = nextMode === 'register' ? 'new-password' : 'current-password';
    authError.textContent = '';
  }

  function setAuthBusy(busy) {
    authSubmit.disabled = busy;
    authSubmit.textContent = busy ? '请稍候…' : (authMode === 'register' ? '注册' : '登录');
  }

  function authMessage(err) {
    const msg = (err && err.message) || String(err || '未知错误');
    if (/Failed to fetch|NetworkError|Load failed|abort/i.test(msg)) return '网络连接失败，请检查网络后重试';
    return msg;
  }

  async function onAuthSubmit(event) {
    event.preventDefault();
    authError.textContent = '';

    const username = authUser.value.trim();
    const password = authPass.value;

    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      authError.textContent = '账号需为 3-16 位字母、数字或下划线';
      return;
    }
    if (password.length < 6) {
      authError.textContent = '密码至少 6 位';
      return;
    }

    setAuthBusy(true);
    try {
      const name = authMode === 'register'
        ? await Cloud.register(username.toLowerCase(), password)
        : await Cloud.login(username.toLowerCase(), password);
      await enterCloud(name, Cloud.role);
    } catch (err) {
      authError.textContent = authMessage(err);
    } finally {
      setAuthBusy(false);
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    document.querySelectorAll('.auth-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { setAuthMode(tab.dataset.tab); });
    });

    authForm.addEventListener('submit', onAuthSubmit);
    guestBtn.addEventListener('click', enterGuest);
    cloudGuestBtn.addEventListener('click', enterGuest);

    document.querySelectorAll('[data-modal]').forEach(function (button) {
      button.addEventListener('click', function () { openModal(button.dataset.modal); });
    });

    restartBtn.addEventListener('click', restartRun);
    endingCollectionBtn.addEventListener('click', function () { openModal('collection'); });

    modalClose.addEventListener('click', closeModal);
    modalLayer.addEventListener('click', function (event) {
      if (event.target === modalLayer) closeModal();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modalLayer.hidden) closeModal();
    });

    modalBody.addEventListener('click', function (event) {
      const actionBtn = event.target.closest('[data-action]');
      if (actionBtn) {
        if (actionBtn.dataset.action === 'restart') {
          restartRun();
          closeModal();
        } else if (actionBtn.dataset.action === 'reset') {
          resetSave();
        } else if (actionBtn.dataset.action === 'editor') {
          closeModal();
          if (window.Editor) window.Editor.open();
        }
        return;
      }
      if (event.target.closest('#logoutBtn')) logoutCloud();
    });

    previewExit.addEventListener('click', endPreview);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && dirty) saveNow(false);
    });
    window.addEventListener('pagehide', function () {
      if (dirty) saveNow(false);
    });
  }

  /* ---------------- 剧情预览与对外接口 ---------------- */

  function startPreview(nextStory, onExit) {
    if (!nextStory || !nextStory.nodes || !nextStory.nodes[nextStory.start]) {
      toast('草稿起点节点无效，无法试玩');
      return;
    }
    if (!state) return;

    previewBackup = {
      story: STORY,
      version: storyVersion,
      source: storySource,
      state: JSON.parse(JSON.stringify(state))
    };
    previewing = true;
    previewExitCallback = onExit || null;

    STORY = nextStory;
    storyVersion = 0;
    storySource = 'draft';
    state = newState();

    previewBar.hidden = false;
    authScreen.hidden = true;
    gameScreen.hidden = false;
    renderNode(state.node);
    dirty = false;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function endPreview() {
    if (!previewing) return;

    const callback = previewExitCallback;

    previewing = false;
    STORY = previewBackup.story;
    storyVersion = previewBackup.version;
    storySource = previewBackup.source;
    state = previewBackup.state;
    previewBackup = null;
    previewExitCallback = null;
    previewBar.hidden = true;

    renderNode(state.node);
    dirty = false;

    if (callback) callback();
  }

  function applyPublishedStory(story, version) {
    if (!story || !story.nodes || !story.nodes[story.start]) return;

    STORY = story;
    storyVersion = version || storyVersion;
    storySource = 'cloud';

    if (!state) return;
    if (!STORY.nodes[state.node]) state.node = STORY.start;
    if (Array.isArray(state.endings) && Array.isArray(STORY.endings)) {
      state.endings = state.endings.filter(function (id) {
        return STORY.endings.some(function (ending) { return ending.id === id; });
      });
    }
    renderNode(state.node);
    dirty = false;
  }

  window.Game = {
    story: function () { return STORY; },
    storyVersion: function () { return storyVersion; },
    storySource: function () { return storySource; },
    role: function () { return cloudRole; },
    api: function (path, options) { return Cloud.api(path, options); },
    uploadImage: function (file) { return Cloud.uploadImage(file); },
    preview: startPreview,
    endPreview: endPreview,
    applyPublishedStory: applyPublishedStory,
    toast: toast
  };

  /* ---------------- 启动 ---------------- */

  async function init() {
    bindEvents();
    setAuthMode('login');

    const loadedStory = await window.StoryStore.load();
    STORY = loadedStory.story;
    storyVersion = loadedStory.version;
    storySource = loadedStory.source;

    const cloudAvailable = await Cloud.detect();
    if (!cloudAvailable) {
      showLocalAuth('当前环境未接入云后端（例如本地静态服务），可进入本地试玩。部署到 Cloudflare Pages 后即可使用云端账号。');
      return;
    }

    showCloudAuth();
    Cloud.token = localStorage.getItem(TOKEN_KEY) || null;
    if (!Cloud.token) return;

    // 已有登录态：直接进入游戏；token 失效则清除并回到登录界面
    setAuthBusy(true);
    try {
      const row = await Cloud.loadGame();
      await enterCloud(row.username || '玩家', row.role);
    } catch (err) {
      if (err && err.status === 401) {
        Cloud.setToken(null);
      } else {
        authError.textContent = authMessage(err);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  init();
})();
