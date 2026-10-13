// MAIN: retain media delivered to this TikTok tab and freeze the clicked video.
(() => {
  if (window.__poststashTikTok) return;
  const items = new Map(), clicks = new Map(), initialScripts = new WeakMap();
  const allowed = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)); }
    catch { return false; }
  };
  const sameAsset = (a, b) => {
    if (!allowed(a) || !allowed(b)) return false;
    try {
      const first = new URL(a), second = new URL(b);
      return first.pathname === second.pathname || first.pathname.split('/').pop() === second.pathname.split('/').pop();
    } catch { return false; }
  };
  // Message/modal viewers may show a photo with no post link or route ID nearby.
  // Fall back to matching the visible source against remembered slideshow assets.
  const matchIdBySrc = src => {
    if (!src) return '';
    for (const [id, item] of [...items.entries()].reverse()) {
      const urls = [...(item.urls || []), ...(item.assets || []).flatMap(asset => asset.urls || [])];
      if (urls.some(url => sameAsset(url, src))) return id;
    }
    return '';
  };
  function remember(payload) {
    const queue = [payload], seen = new Set();
    for (let index = 0; index < queue.length && index < 40000; index++) {
      const node = queue[index];
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const id = String(node.id || '');
      if (/^\d{10,}$/.test(id)) {
        const username = node.author?.uniqueId || 'tiktok';
        const video = node.video;
        if (video) {
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
            items.set(id, {id, group: id, username, kind: 'video', urls: [...new Set(urls)]});
          }
        }
        const rawImages = node.imagePost?.images || node.image_post?.images || node.imagePost?.imageList || [];
        if (Array.isArray(rawImages) && rawImages.length) {
          const assets = [];
          for (const entry of rawImages) {
            const urls = [];
            const add = value => { if (allowed(value)) urls.push(value); };
            const address = value => {
              if (!value) return;
              if (typeof value === 'string') add(value);
              else {
                for (const url of value.UrlList || value.urlList || value.url_list || []) add(url);
                address(value.imageURL); address(value.displayImage); address(value.thumbnail);
              }
            };
            address(entry?.imageURL); address(entry?.displayImage); address(entry?.thumbnail); address(entry);
            const unique = [...new Set(urls)];
            if (unique.length) assets.push({kind: 'image', urls: unique});
          }
          if (assets.length) {
            items.delete(id);
            items.set(id, {id, group: id, username, kind: assets.length > 1 ? 'carousel' : 'image', urls: [...assets[0].urls], assets});
          }
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
  function postId(element, src) {
    for (let node = element, depth = 0; node && depth < 12; node = node.parentElement, depth++) {
      const match = node.id?.match(/^xgwrapper-\d+-(\d{10,})$/);
      if (match) return match[1];
      const dataId = node.getAttribute?.('data-video-id');
      if (/^\d{10,}$/.test(dataId || '')) return dataId;
      const link = node.querySelector?.('a[href*="/video/"],a[href*="/photo/"]')?.getAttribute('href') || (node.tagName === 'A' ? node.getAttribute('href') : '');
      const hrefId = link?.match(/\/@[^/]+\/(?:video|photo)\/(\d{10,})/)?.[1];
      if (hrefId) return hrefId;
    }
    return location.pathname.match(/\/@[^/]+\/(?:video|photo)\/(\d{10,})/)?.[1] || matchIdBySrc(src || element?.currentSrc || element?.src) || '';
  }
  function current() {
    if (/\/live(?:\/|$)/.test(location.pathname)) return null;
    const candidates = [];
    for (const video of document.querySelectorAll('video')) {
      const rect = video.getBoundingClientRect(), style = getComputedStyle(video);
      const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      const visible = style.visibility !== 'hidden' && style.display !== 'none' && !video.closest('[aria-hidden="true"]');
      const id = postId(video, video.currentSrc || video.src);
      if (id && visible && area > 0 && rect.width > 80 && rect.height > 80) candidates.push({element: video, rect, area, id, kind: 'video', playing: !video.paused});
    }
    for (const img of document.querySelectorAll('img')) {
      if (img.closest('[aria-hidden="true"]')) continue;
      const rect = img.getBoundingClientRect(), style = getComputedStyle(img);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      if (area <= 0 || rect.width < 150 || rect.height < 150) continue;
      const src = img.currentSrc || img.src || '';
      if (/avatar|icon|logo|emoji/i.test(src)) continue;
      const id = postId(img, src);
      if (id) candidates.push({element: img, rect, area, id, kind: 'image'});
    }
    candidates.sort((a, b) => Number(Boolean(b.playing)) - Number(Boolean(a.playing)) || Number(b.area / (b.rect.width * b.rect.height) > .5) - Number(a.area / (a.rect.width * a.rect.height) > .5) || b.area - a.area);
    return candidates[0] || null;
  }
  function snapshot(id) {
    readInitial();
    const active = current();
    if (!active || active.id !== id) return {error: 'The post changed. Use the download button beside the current post.'};
    const item = items.get(id);
    if (item) return {...item, urls: [...item.urls], assets: item.assets?.map(asset => ({...asset, urls: [...asset.urls]}))};
    if (active.kind === 'video') {
      const source = active.element.currentSrc || active.element.src;
      if (allowed(source)) return {id, group: id, username: location.pathname.match(/^\/@([^/]+)/)?.[1] || 'tiktok', kind: 'video', urls: [source]};
    } else {
      const source = active.element.currentSrc || active.element.src;
      if (allowed(source)) return {id, group: id, username: location.pathname.match(/^\/@([^/]+)/)?.[1] || 'tiktok', kind: 'image', urls: [source]};
    }
    return {error: 'TikTok has not exposed a complete source for this post. Refresh the page and try again.'};
  }
  function refresh() {
    readInitial();
    const active = current();
    for (const node of document.querySelectorAll('[data-poststash-tiktok-active]')) if (node !== active?.element) node.removeAttribute('data-poststash-tiktok-active');
    if (active && active.element.getAttribute('data-poststash-tiktok-active') !== active.id) active.element.setAttribute('data-poststash-tiktok-active', active.id);
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
