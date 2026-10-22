/* 玩家页：从 /g/<code> 读取随机码，拉取已发布剧情后直接开始
 * 不需要账号，进度保存在本机浏览器
 */
(function () {
  'use strict';

  const errorScreen = document.getElementById('errorScreen');
  const errorText = document.getElementById('errorText');

  function showError(message) {
    errorScreen.hidden = false;
    errorText.textContent = message;
    document.getElementById('gameScreen').hidden = true;
  }

  function parseCode() {
    const match = location.pathname.match(/\/g\/([A-Za-z0-9]+)\/?$/);
    return match ? match[1].toLowerCase() : '';
  }

  async function init() {
    const code = parseCode();
    if (!code) {
      showError('链接无效或暂未开放');
      return;
    }

    try {
      const res = await fetch('/api/game/' + encodeURIComponent(code), { cache: 'no-store' });
      if (res.status === 404) {
        showError('链接无效或暂未开放');
        return;
      }
      if (!res.ok) {
        showError('加载失败，请稍后重试');
        return;
      }

      const data = await res.json();
      window.Engine.boot(data.story, {
        title: data.title,
        saveKey: 'story.save.' + code
      });
    } catch (err) {
      showError('网络连接失败，请稍后重试');
    }
  }

  init();
})();
