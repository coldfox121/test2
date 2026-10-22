/* 界面配色：5 套主题，选择结果存在本机 */
(function () {
  'use strict';

  const KEY = 'story.theme';

  const THEMES = [
    { id: 'amber', name: '琥珀夜', bg: '#141210', accent: '#d9a441' },
    { id: 'jade', name: '青雾', bg: '#0d1512', accent: '#5fbf9d' },
    { id: 'indigo', name: '靛夜', bg: '#0f1220', accent: '#7f9cf5' },
    { id: 'rose', name: '绛夜', bg: '#170f14', accent: '#e08a9b' },
    { id: 'paper', name: '暖纸', bg: '#efe6d6', accent: '#a8641c' }
  ];

  function find(id) {
    return THEMES.find(function (theme) { return theme.id === id; }) || THEMES[0];
  }

  function current() {
    try {
      return find(localStorage.getItem(KEY) || 'amber').id;
    } catch (err) {
      return 'amber';
    }
  }

  function apply(id) {
    const theme = find(id);

    if (theme.id === 'amber') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme.id);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.bg);

    try {
      localStorage.setItem(KEY, theme.id);
    } catch (err) {
      // 隐私模式下无法保存，仅本次生效
    }

    document.querySelectorAll('[data-theme-choice]').forEach(function (button) {
      const active = button.dataset.themeChoice === theme.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function markup() {
    const active = current();
    return THEMES.map(function (theme) {
      return '<button type="button" class="theme-dot' + (theme.id === active ? ' active' : '') +
        '" data-theme-choice="' + theme.id + '" title="' + theme.name + '" aria-label="' + theme.name +
        '" aria-pressed="' + (theme.id === active ? 'true' : 'false') +
        '" style="--dot-bg:' + theme.bg + ';--dot-accent:' + theme.accent + '"><span></span></button>';
    }).join('');
  }

  function mount(element) {
    if (!element) return;
    element.innerHTML = markup();
    element.classList.add('theme-dots');
  }

  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-theme-choice]');
    if (button) apply(button.dataset.themeChoice);
  });

  function mountAll() {
    document.querySelectorAll('[data-theme-mount]').forEach(mount);
  }

  apply(current());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();

  window.Theme = { apply: apply, current: current, markup: markup, mount: mount, list: THEMES };
})();
