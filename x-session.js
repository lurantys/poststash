// MAIN: retain media from X responses already delivered to this tab, scoped to individual posts.
(() => {
  if (window.__poststashX) return;
  const posts = new Map(), clicks = new Map();
  const allowed = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['pbs.twimg.com', 'video.twimg.com'].includes(url.hostname);
    } catch { return false; }
  };
  const mediaFor = tweet => {
    const result = tweet?.tweet || tweet;
    const legacy = result?.legacy || result?.tweet_results?.result?.legacy;
    const id = String(result?.rest_id || legacy?.id_str || legacy?.id || '');
    if (!/^\d{5,}$/.test(id) || !legacy) return null;
    const user = result.core?.user_results?.result?.legacy || result.core?.user_results?.result || {};
    const username = user.screen_name || user.legacy?.screen_name || 'x-user';
    const entries = legacy.extended_entities?.media || legacy.entities?.media || [];
    const assets = [];
    for (const [index, entry] of entries.entries()) {
      if (entry.type === 'photo') {
        const raw = entry.media_url_https || entry.media_url;
        if (raw && allowed(raw)) {
          const imageUrl = new URL(raw);
          imageUrl.searchParams.set('name', 'orig');
          assets.push({kind: 'image', urls: [imageUrl.href], index: index + 1});
        }
      } else if (entry.type === 'video' || entry.type === 'animated_gif') {
        const variants = (entry.video_info?.variants || [])
          .filter(item => item.content_type === 'video/mp4' && allowed(item.url))
          .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
        if (variants.length) assets.push({kind: 'video', urls: variants.map(item => item.url), index: index + 1});
      }
    }
    return assets.length ? {id, username, assets} : null;
  };
  const remember = payload => {
    const seen = new Set(), queue = [payload];
    for (let index = 0; index < queue.length && index < 50000; index++) {
      const node = queue[index];
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const post = mediaFor(node);
      if (post) {
        const previous = posts.get(post.id);
        if (previous) {
          const merged = new Map(previous.assets.map(asset => [`${asset.index}:${asset.kind}`, asset]));
          for (const asset of post.assets) merged.set(`${asset.index}:${asset.kind}`, asset);
          post.assets = [...merged.values()].sort((a, b) => a.index - b.index);
        }
        posts.delete(post.id);
        posts.set(post.id, post);
      }
      for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
    }
    while (posts.size > 1500) posts.delete(posts.keys().next().value);
  };
  const readResponse = response => response.clone().json().then(remember).catch(() => {});
  const nativeFetch = window.fetch;
  window.fetch = function(input, init) {
    const response = nativeFetch.call(this, input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (/\/graphql\//i.test(url)) response.then(readResponse).catch(() => {});
    return response;
  };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__poststashXGraphql = /\/graphql\//i.test(String(url));
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    if (this.__poststashXGraphql) this.addEventListener('load', () => {
      try { remember(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {}
    }, {once: true});
    return send.apply(this, args);
  };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const host = target?.closest('[data-poststash-x-button]');
    if (!host) return;
    const clickId = crypto.randomUUID();
    const post = posts.get(host.dataset.postId);
    clicks.set(clickId, post ? {...post, username: host.dataset.postUsername || post.username, assets: post.assets.map(asset => ({...asset, urls: [...asset.urls]}))} : null);
    host.dataset.clickId = clickId;
    while (clicks.size > 24) clicks.delete(clicks.keys().next().value);
    setTimeout(() => clicks.delete(clickId), 60000);
  }, true);
  window.__poststashX = {posts, clicks, remember, allowed};
})();
