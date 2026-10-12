// Runs in MAIN, alongside Instagram. Keeps only media already delivered to this tab.
(() => {
  const items = new Map();
  const allowed = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['instagram.com', 'cdninstagram.com', 'cdninstagram.net', 'fbcdn.net']
        .some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch { return false; }
  };
  const canonicalId = value => String(value || '').split('_')[0];
  const fromNode = node => {
    if (!node || typeof node !== 'object') return null;
    const videos = [], images = [];
    const list = value => Array.isArray(value) ? value : [];
    const add = (list, url, width = 0, height = 0) => {
      if (allowed(url)) list.push({url, quality: Number(width) * Number(height) || 0});
    };
    add(videos, node.video_url);
    for (const entry of list(node.video_versions || node.video_resources)) add(videos, entry?.url || entry?.src, entry?.width, entry?.height);
    const delivery = node.videoDeliveryResponseResult || node.videoDeliveryResponseFragment || node.video_delivery_response;
    for (const entry of list(delivery?.progressive_urls || delivery?.video_delivery_response?.progressive_urls || node.progressive_urls)) add(videos, entry?.progressive_url || entry?.url, entry?.width, entry?.height);
    add(images, node.display_url);
    for (const entry of list(node.image_versions2?.candidates || node.image_versions?.candidates || node.display_resources)) add(images, entry?.url || entry?.src, entry?.width || entry?.config_width, entry?.height || entry?.config_height);
    const carousel = node.carousel_media || list(node.edge_sidecar_to_children?.edges).map(edge => edge?.node);
    const slides = Array.isArray(carousel) ? carousel.map(fromNode).filter(Boolean) : [];
    if (!videos.length && !images.length && !slides.length) return null;
    const unique = entries => [...new Map(entries.sort((a, b) => b.quality - a.quality).map(entry => [entry.url, entry])).values()].map(entry => entry.url);
    return {
      id: canonicalId(node.pk || node.id || node.media_id || node.mediaId || node.video_id),
      shortcode: node.code || node.shortcode || '',
      username: node.user?.username || node.owner?.username || '',
      kind: slides.length ? 'carousel' : videos.length ? 'video' : 'image',
      urls: unique(videos.length ? videos : images),
      images: unique(images), slides
    };
  };
  const remember = payload => {
    const seen = new Set(), queue = [payload];
    for (let index = 0; index < queue.length && index < 50000; index++) {
      const node = queue[index];
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const item = fromNode(node);
      if (item) {
        const key = item.id || item.shortcode || item.urls[0];
        const previous = items.get(key);
        // Merge incremental GraphQL patches without replacing a video with its thumbnail.
        const rank = kind => ({image: 1, video: 2, carousel: 3}[kind] || 0);
        if (!previous || rank(item.kind) >= rank(previous.kind)) {
          item.username ||= previous?.username || '';
          item.shortcode ||= previous?.shortcode || '';
          if (previous?.kind === item.kind) {
            item.urls = [...new Set([...item.urls, ...previous.urls])];
            item.images = [...new Set([...item.images, ...previous.images])];
          }
          items.delete(key);
          items.set(key, item);
        }
      }
      for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
    }
    while (items.size > 2000) items.delete(items.keys().next().value);
  };
  const parseText = text => {
    const clean = String(text || '').replace(/^\s*(?:for\s*\(;;\);|\)\]\}',?)\s*/, '').trim();
    try { const payload = JSON.parse(clean); remember(payload); return [payload]; } catch {}
    const payloads = [];
    // Instagram can send newline-delimited GraphQL patches, rather than one JSON object.
    for (const line of clean.split(/\r?\n/)) {
      try { const payload = JSON.parse(line); remember(payload); payloads.push(payload); } catch {}
    }
    return payloads;
  };
  window.__poststashMedia = {items, allowed, canonicalId, fromNode, remember, parseText};
})();
