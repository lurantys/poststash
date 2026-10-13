// MAIN: retain media delivered to this TikTok tab and freeze the clicked video.
(() => {
  if (window.__poststashTikTok) return;
  const items = new Map(), clicks = new Map(), initialScripts = new WeakMap();
  const allowed = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)); }
    catch { return false; }
  };
  function remember(payload) {
    const queue = [payload], seen = new Set();
    for (let index = 0; index < queue.length && index < 40000; index++) {
      const node = queue[index];
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const video = node.video, id = String(node.id || '');
      if (video && /^\d{10,}$/.test(id)) {
        const urls = [];
        const add = value => { if (allowed(value) && !/\.m3u8(?:\?|$)/i.test(value)) urls.push(value); };
        const address = value => {
          if (typeof value === 'string') add(value);
          else for (const url of value?.UrlList || value?.urlList || []) add(url);
        };
        const bitrates = Array.isArray(video.bitrateInfo) ? [...video.bitrateInfo].sort((a, b) => Number(b.Bitrate || 0) - Number(a.Bitrate || 0)) : [];
        for (const bitrate of bitrates) address(bitrate.PlayAddr);
        address(video.playAddr); address(video.PlayAddrStruct); address(video.downloadAddr);
        if (urls.length) {
          items.delete(id);
          items.set(id, {id, group: id, username: node.author?.uniqueId || 'tiktok', kind: 'video', urls: [...new Set(urls)]});
        }
      }
      for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
    }
    while (items.size > 1000) items.delete(items.keys().next().value);
  }
  function readInitial() {
    for (const script of document.querySelectorAll('#__UNIVERSAL_DATA_FOR_REHYDRATION__,#SIGI_STATE')) {
      const source = script.textContent;
      if (initialScripts.get(script) === source) continue;
      try { remember(JSON.parse(source)); initialScripts.set(script, source); } catch {}
    }
  }
  function videoId(video) {
    for (let node = video, depth = 0; node && depth < 12; node = node.parentElement, depth++) {
      const match = node.id?.match(/^xgwrapper-\d+-(\d{10,})$/);
      if (match) return match[1];
      const id = node.getAttribute('data-video-id');
      if (/^\d{10,}$/.test(id || '')) return id;
    }
    return location.pathname.match(/\/@[^/]+\/video\/(\d{10,})/)?.[1] || '';
  }
  function current() {
    if (/\/live(?:\/|$)/.test(location.pathname)) return null;
    const visible = [...document.querySelectorAll('video')].map(video => {
      const rect = video.getBoundingClientRect(), style = getComputedStyle(video);
      const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      return {video, rect, area, id: videoId(video), visible: style.visibility !== 'hidden' && style.display !== 'none' && !video.closest('[aria-hidden="true"]')};
    }).filter(item => item.id && item.visible && item.area > 0 && item.rect.width > 80 && item.rect.height > 80);
    visible.sort((a, b) => Number(b.area / (b.rect.width * b.rect.height) > .5) - Number(a.area / (a.rect.width * a.rect.height) > .5) || Number(!b.video.paused) - Number(!a.video.paused) || b.area - a.area);
    return visible[0] || null;
  }
  function snapshot(id) {
    readInitial();
    const active = current();
    if (!active || active.id !== id) return {error: 'The video changed. Use the download button beside the current video.'};
    const item = items.get(id);
    if (item) return {...item, urls: [...item.urls]};
    const source = active.video.currentSrc || active.video.src;
    if (allowed(source)) return {id, group: id, username: location.pathname.match(/^\/@([^/]+)/)?.[1] || 'tiktok', kind: 'video', urls: [source]};
    return {error: 'TikTok has not exposed a complete source for this video. Refresh the page and try again.'};
  }
  function refresh() {
    readInitial();
    const active = current();
    for (const video of document.querySelectorAll('[data-poststash-tiktok-active]')) if (video !== active?.video) video.removeAttribute('data-poststash-tiktok-active');
    if (active && active.video.getAttribute('data-poststash-tiktok-active') !== active.id) active.video.setAttribute('data-poststash-tiktok-active', active.id);
  }
  const capture = response => { response.clone().json().then(remember).catch(() => {}); };
  const nativeFetch = window.fetch;
  window.fetch = function(input, init) {
    const result = nativeFetch.call(this, input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (/\/api\//.test(url)) result.then(capture).catch(() => {});
    return result;
  };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) { this.__poststashTikTokApi = /\/api\//.test(String(url)); return open.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function(...args) {
    if (this.__poststashTikTokApi) this.addEventListener('load', () => {
      try { remember(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {}
    }, {once: true});
    return send.apply(this, args);
  };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const host = target?.closest('[data-poststash-tiktok-button]');
    if (!host) return;
    const clickId = crypto.randomUUID();
    clicks.set(clickId, snapshot(host.dataset.videoId));
    host.dataset.clickId = clickId;
    while (clicks.size > 32) clicks.delete(clicks.keys().next().value);
    setTimeout(() => clicks.delete(clickId), 60000);
  }, true);
  window.__poststashTikTok = {items, clicks, remember, current, snapshot};
  for (const event of ['scroll', 'resize', 'popstate', 'loadedmetadata', 'play', 'pause']) window.addEventListener(event, refresh, true);
  setInterval(refresh, 250);
  refresh();
})();
