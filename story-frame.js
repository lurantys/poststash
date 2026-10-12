// MAIN: identify the current frame and freeze its media synchronously with the user's click.
(() => {
  if (window.__poststashStoryFrames) return;
  const clicks = new Map(), tokens = new WeakMap();
  window.__poststashStoryFrames = {clicks};
  let current = null, queued = false, busy = false, viewerHint = null;
  const notify = () => window.postMessage({source: 'poststash-story-frame', type: 'changed'}, location.origin);
  const clear = () => {
    if (current) { current.node.removeAttribute('data-poststash-story-active'); current = null; notify(); }
  };
  const playerRefs = node => {
    const refs = [];
    for (let element = node, level = 0; element && level < 6; element = element.parentElement, level++) {
      for (const key of Object.keys(element)) {
        if (key.startsWith('__reactProps$')) refs.push(element[key]);
        if (key.startsWith('__reactFiber$')) {
          for (let fiber = element[key], depth = 0; fiber && depth < 12; fiber = fiber.return, depth++) refs.push(fiber.memoizedProps, fiber.memoizedState);
        }
      }
    }
    return refs;
  };
  async function refresh() {
    if (busy) return;
    const route = location.pathname.split('/').filter(Boolean);
    const storyRoute = route[0] === 'stories';
    const dialog = document.querySelector('[role="dialog"]');
    if (!storyRoute && !(viewerHint && Date.now() - viewerHint.at < 120000 && dialog)) { clear(); return; }
    const category = storyRoute ? route[1] === 'highlights' ? 'highlights' : 'stories' : viewerHint.category;
    const scope = storyRoute ? document : dialog;
    const nodes = [...scope.querySelectorAll('video,img')].filter(node => {
      const r = node.getBoundingClientRect(), style = getComputedStyle(node);
      return r.width > 120 && r.height > 120 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && style.visibility !== 'hidden' && style.display !== 'none' && !node.closest('[aria-hidden="true"]');
    }).sort((a, b) => {
      const score = node => {
        const r = node.getBoundingClientRect();
        return Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * (r.left <= innerWidth / 2 && r.right >= innerWidth / 2 ? 3 : 1) + (node.tagName === 'VIDEO' ? 1 : 0);
      };
      return score(b) - score(a);
    });
    const node = nodes[0];
    if (!node) { clear(); return; }
    const refs = playerRefs(node);
    const source = node.currentSrc || node.src || '', poster = node.poster || '';
    if (current?.node === node && current.source === source && current.poster === poster && current.route === location.href && current.category === category && refs.length === current.refs.length && refs.every((ref, index) => ref === current.refs[index])) return;
    busy = true;
    try {
      let token = tokens.get(node);
      if (!token) { token = crypto.randomUUID(); tokens.set(node, token); node.setAttribute('data-poststash-story-media', token); }
      const result = await resolveViewerMedia({category, mediaToken: token, currentStory: true});
      if (!node.isConnected || source !== (node.currentSrc || node.src || '') || poster !== (node.poster || '')) { schedule(); return; }
      const signature = `${category}|${result.id || ''}|${source}|${poster}|${location.pathname}`;
      const changed = current?.node !== node || current.signature !== signature;
      if (current?.node !== node) current?.node.removeAttribute('data-poststash-story-active');
      const version = changed ? crypto.randomUUID() : current.version;
      current = {node, source, poster, route: location.href, category, refs, signature, version};
      node.setAttribute('data-poststash-story-category', category);
      if (node.getAttribute('data-poststash-story-active') !== version) node.setAttribute('data-poststash-story-active', version);
      if (changed) notify();
    } finally { busy = false; }
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; refresh().catch(() => {}); });
  }
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('[data-poststash-story-button]');
    if (button) {
      const clickId = crypto.randomUUID();
      // resolveViewerMedia reads the player before its first await. Later slide changes
      // cannot redirect this download while Chrome starts the background operation.
      clicks.set(clickId, resolveViewerMedia({category: button.dataset.storyCategory, username: button.dataset.storyUsername, mediaToken: button.dataset.storyMediaToken, currentStory: true}));
      button.dataset.storyClickId = clickId;
      while (clicks.size > 32) clicks.delete(clicks.keys().next().value);
      setTimeout(() => clicks.delete(clickId), 60000);
      return;
    }
    const link = target?.closest('a[href*="/stories/"]');
    const control = target?.closest('[aria-label],[title],button,[role="button"]');
    const label = `${control?.getAttribute('aria-label') || ''} ${control?.getAttribute('title') || ''} ${control?.textContent || ''}`;
    if (link || /story|highlight/i.test(label)) viewerHint = {category: /highlight/i.test(link?.href || label) ? 'highlights' : 'stories', at: Date.now()};
    schedule();
  }, true);
  new MutationObserver(schedule).observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'poster', 'aria-hidden']});
  for (const event of ['popstate', 'resize', 'loadedmetadata', 'emptied']) window.addEventListener(event, schedule, true);
  setInterval(schedule, 150);
  schedule();
})();
