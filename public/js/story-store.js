/* 剧情来源：优先读取云端已发布版本，失败时回退到内置 story.js */
(function () {
  'use strict';

  const FALLBACK = window.STORY;

  function usable(story) {
    return story && typeof story === 'object' &&
      story.nodes && typeof story.nodes === 'object' &&
      typeof story.start === 'string' && story.nodes[story.start];
  }

  async function load() {
    try {
      const res = await fetch('/api/story', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && usable(data.story)) {
          return { story: data.story, version: data.version || 0, source: 'cloud' };
        }
      }
    } catch (err) {
      // 本地静态服务没有 /api，直接使用内置剧情
    }
    return { story: FALLBACK, version: 0, source: 'builtin' };
  }

  window.StoryStore = { load: load, usable: usable };
})();
