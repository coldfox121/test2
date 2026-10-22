/* 界面配色：由作者在编辑器里为每个故事选择，玩家端跟随故事设置 */
(function () {
  'use strict';

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

  function set(id) {
    const theme = find(id);

    if (theme.id === 'amber') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme.id);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.bg);

    return theme.id;
  }

  function current() {
    return document.documentElement.getAttribute('data-theme') || 'amber';
  }

  function markup(selected, attribute) {
    const active = find(selected || current()).id;

    return THEMES.map(function (theme) {
      return '<button type="button" class="theme-dot' + (theme.id === active ? ' active' : '') +
        '" ' + attribute + '="' + theme.id + '" title="' + theme.name + '" aria-label="' + theme.name +
        '" aria-pressed="' + (theme.id === active ? 'true' : 'false') +
        '" style="--dot-bg:' + theme.bg + ';--dot-accent:' + theme.accent + '"><span></span></button>';
    }).join('');
  }

  set('amber');

  window.Theme = { set: set, current: current, markup: markup, find: find, list: THEMES };
})();
