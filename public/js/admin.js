/* 管理端：登录、游戏列表、新建/发布/停止发布/删除、打开编辑器 */
(function () {
  'use strict';

  const TOKEN_KEY = 'story.admin.token';

  const loginScreen = document.getElementById('adminLogin');
  const consoleScreen = document.getElementById('consoleScreen');
  const form = document.getElementById('adminForm');
  const userInput = document.getElementById('adminUser');
  const passInput = document.getElementById('adminPass');
  const errorEl = document.getElementById('adminError');
  const submitBtn = document.getElementById('adminSubmit');
  const gameList = document.getElementById('gameList');
  const emptyHint = document.getElementById('emptyHint');
  const adminNameEl = document.getElementById('adminName');

  let token = localStorage.getItem(TOKEN_KEY) || '';
  let games = [];
  let currentGame = null;
  let busy = false;

  /* ---------------- 请求 ---------------- */

  async function api(path, options) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    const res = await fetch('/api/' + path, Object.assign({}, options, { headers: headers }));
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      // 统一在下面处理
    }
    if (!res.ok) {
      const error = new Error(data.error || ('请求失败 (' + res.status + ')'));
      error.status = res.status;
      throw error;
    }
    return data;
  }

  async function uploadImage(path, file) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;

    const body = new FormData();
    body.append('file', file);

    const res = await fetch('/api/' + path, { method: 'POST', headers: headers, body: body });
    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      // 统一处理
    }
    if (!res.ok) {
      const error = new Error(data.error || ('上传失败 (' + res.status + ')'));
      error.status = res.status;
      throw error;
    }
    return data;
  }

  /* ---------------- 编辑器所需接口 ---------------- */

  window.Game = {
    role: function () { return 'admin'; },
    story: function () { return window.Engine.story(); },
    api: function (path, options) {
      if (!currentGame) return Promise.reject(new Error('还没有选择游戏'));
      return api('admin/games/' + currentGame.id + '/' + path, options);
    },
    uploadImage: function (file) {
      if (!currentGame) return Promise.reject(new Error('还没有选择游戏'));
      return uploadImage('admin/games/' + currentGame.id + '/images', file);
    },
    preview: function (story, onExit, options) {
      if (currentGame) {
        const brand = document.querySelector('.brand-name');
        if (brand) brand.textContent = currentGame.title;
      }
      consoleScreen.hidden = true;
      window.Engine.preview(story, function () {
        consoleScreen.hidden = false;
        if (onExit) onExit();
      }, options);
    },
    applyPublishedStory: function (story, version) {
      window.Engine.applyStory(story);
      if (currentGame) currentGame.version = version || currentGame.version;
      loadGames().catch(function () {});
    },
    toast: function (message) { window.Engine.toast(message); }
  };

  /* ---------------- 登录 ---------------- */

  function setBusy(next) {
    busy = next;
    submitBtn.disabled = next;
    submitBtn.textContent = next ? '请稍候…' : '登录';
  }

  async function onSubmit(event) {
    event.preventDefault();
    errorEl.textContent = '';

    const username = userInput.value.trim();
    const password = passInput.value;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      errorEl.textContent = '账号需为 3-16 位字母、数字或下划线';
      return;
    }
    if (password.length < 6) {
      errorEl.textContent = '密码至少 6 位';
      return;
    }

    setBusy(true);
    try {
      const data = await api('login', {
        method: 'POST',
        body: JSON.stringify({ username: username.toLowerCase(), password: password })
      });
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      adminNameEl.textContent = data.username;
      await enterConsole();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      setBusy(false);
    }
  }

  async function enterConsole() {
    loginScreen.hidden = true;
    consoleScreen.hidden = false;
    await loadGames();
  }

  async function logout() {
    try {
      await api('logout', { method: 'POST', body: '{}' });
    } catch (err) {
      // 本地清掉即可
    }
    token = '';
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  }

  /* ---------------- 游戏列表 ---------------- */

  function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderGames() {
    emptyHint.hidden = games.length > 0;
    gameList.innerHTML = games.map(function (game) {
      const published = game.status === 'published';
      return '<article class="game-card" data-id="' + game.id + '">' +
        '<div class="game-card-main">' +
          '<h2>' + escapeHtml(game.title) +
            '<span class="badge ' + (published ? 'published' : 'draft') + '">' +
              (published ? '已发布' : '私有') +
            '</span>' +
          '</h2>' +
          '<p class="game-meta">/g/' + escapeHtml(game.code) + ' · 线上 v' + (game.version || 0) +
            ' · 更新 ' + formatTime(game.updated_at) + '</p>' +
        '</div>' +
        '<div class="game-card-actions">' +
          '<button type="button" class="btn-secondary" data-act="edit">编辑</button>' +
          '<button type="button" class="btn-ghost" data-act="rename">改名</button>' +
          '<button type="button" class="btn-ghost" data-act="link">复制链接</button>' +
          '<button type="button" class="btn-ghost" data-act="' + (published ? 'unpublish' : 'publish') + '">' +
            (published ? '停止发布' : '发布') +
          '</button>' +
          '<button type="button" class="btn-ghost danger" data-act="delete">删除</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  async function loadGames() {
    const data = await api('admin/games', { method: 'GET' });
    games = data.games || [];
    renderGames();
  }

  function byId(id) {
    return games.find(function (game) { return game.id === id; }) || null;
  }

  async function newGame() {
    const title = prompt('新游戏名称', '未命名故事');
    if (title === null) return;
    const name = title.trim();
    if (!name) {
      window.Engine.toast('请填写游戏名称');
      return;
    }

    const tpl = prompt(
      '选择初始模板：\n1 = 空白（起点 + 结局）\n2 = 三幕式\n3 = 教程（演示旗标与数值）\n4 = 多结局\n\n输入 1-4，留空默认 1',
      '1'
    );
    if (tpl === null) return;
    const templateMap = { '1': 'blank', '2': 'three-act', '3': 'tutorial', '4': 'multi-ending' };
    const template = templateMap[String(tpl).trim()] || 'blank';

    try {
      const data = await api('admin/games', { method: 'POST', body: JSON.stringify({ title: name, template: template }) });
      await loadGames();
      const game = byId(data.game.id);
      if (game) openEditor(game);
    } catch (err) {
      window.Engine.toast('新建失败：' + err.message);
    }
  }

  async function renameGame(game) {
    const next = prompt('修改游戏名称', game.title);
    if (next === null) return;
    const name = next.trim().slice(0, 60);
    if (!name) return window.Engine.toast('名称不能为空');
    if (name === game.title) return;

    try {
      await api('admin/games/' + game.id, { method: 'PUT', body: JSON.stringify({ title: name }) });
      await loadGames();
      window.Engine.toast('已改名为《' + name + '》');
      if (currentGame && currentGame.id === game.id) {
        currentGame.title = name;
        document.getElementById('editorTitle').textContent = '剧情编辑器 · ' + name;
      }
    } catch (err) {
      window.Engine.toast('改名失败：' + err.message);
    }
  }

  async function openEditor(game) {
    currentGame = game;
    document.getElementById('editorTitle').textContent = '剧情编辑器 · ' + game.title;
    if (window.Editor) await window.Editor.open();
  }

  async function copyLink(game) {
    const url = location.origin + '/g/' + game.code;
    try {
      await navigator.clipboard.writeText(url);
      window.Engine.toast('链接已复制');
    } catch (err) {
      prompt('复制下面的链接', url);
    }
  }

  async function togglePublish(game) {
    const published = game.status === 'published';
    if (published && !confirm('停止发布后玩家将无法进入，线上内容会保留。确定吗？')) return;

    try {
      await api('admin/games/' + game.id + '/' + (published ? 'unpublish' : 'publish'), {
        method: 'POST',
        body: JSON.stringify({ note: '' })
      });
      await loadGames();
      window.Engine.toast(published ? '已停止发布' : '已发布');
    } catch (err) {
      window.Engine.toast((published ? '停止发布失败：' : '发布失败：') + err.message);
    }
  }

  async function removeGame(game) {
    if (!confirm('确定删除《' + game.title + '》吗？剧情与版本记录都会清除，播放进度也会失效，无法恢复。')) return;

    try {
      await api('admin/games/' + game.id, { method: 'DELETE' });
      await loadGames();
      window.Engine.toast('已删除');
    } catch (err) {
      window.Engine.toast('删除失败：' + err.message);
    }
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    form.addEventListener('submit', onSubmit);

    document.getElementById('newGameBtn').addEventListener('click', newGame);
    document.getElementById('logoutBtn').addEventListener('click', logout);

    gameList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-act]');
      if (!button) return;
      const card = event.target.closest('.game-card');
      const game = card && byId(card.dataset.id);
      if (!game) return;

      const act = button.dataset.act;
      if (act === 'edit') openEditor(game);
      else if (act === 'rename') renameGame(game);
      else if (act === 'link') copyLink(game);
      else if (act === 'publish' || act === 'unpublish') togglePublish(game);
      else if (act === 'delete') removeGame(game);
    });
  }

  /* ---------------- 启动 ---------------- */

  async function init() {
    bind();

    if (!token) return;

    try {
      const me = await api('admin/games', { method: 'GET' });
      games = me.games || [];
      loginScreen.hidden = true;
      consoleScreen.hidden = false;
      renderGames();
    } catch (err) {
      if (err.status === 401) {
        token = '';
        localStorage.removeItem(TOKEN_KEY);
      } else {
        errorEl.textContent = '加载失败：' + err.message;
      }
    }
  }

  init();
})();
