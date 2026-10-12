// Serialized by executeScript into MAIN. No metadata requests or playback recording.
async function resolveViewerMedia(options = {}) {
  try {
  if (options.storyClickId) {
    const clicks = window.__poststashStoryFrames?.clicks;
    const snapshot = clicks?.get(options.storyClickId);
    if (!snapshot) throw new Error('This Story button is no longer current. Click the button inside the visible Story.');
    try { return await snapshot; } finally { clicks.delete(options.storyClickId); }
  }
  const media = window.__poststashMedia;
  if (!media) throw new Error('Poststash session capture is missing. Refresh this Instagram tab after reloading the extension.');
  const route = location.pathname.split('/').filter(Boolean);
  const story = ['stories', 'highlights'].includes(options.category);
  const dialog = document.querySelector('[role="dialog"]');
  const scope = story && route[0] === 'stories' ? document : dialog || document;
  const visible = [...scope.querySelectorAll('video,img')].filter(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 120 && rect.height > 120 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  }).sort((a, b) => {
    const score = node => {
      const rect = node.getBoundingClientRect();
      const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      const centered = rect.left <= innerWidth / 2 && rect.right >= innerWidth / 2;
      return area * (centered ? 3 : 1) + (node.tagName === 'VIDEO' ? 1 : 0);
    };
    return score(b) - score(a);
  });
  const active = options.mediaToken ? document.querySelector(`[data-poststash-story-media="${CSS.escape(options.mediaToken)}"]`) : visible[0];
  if (!active) throw new Error('No visible Story, Highlight, or post media was found in the viewer.');
  const source = active.currentSrc || active.src || '';
  const poster = active.poster || '';
  const kind = active.tagName === 'VIDEO' ? 'video' : 'image';
  // Story-frame buttons resolve the actual player; Instagram can leave an earlier ID in the URL.
  const selectedId = options.currentStory ? '' : media.canonicalId(new URL(location.href).searchParams.get('story_media_id') || (story && route[1] !== 'highlights' ? route[2] : ''));
  const sameAsset = (a, b) => {
    if (!media.allowed(a) || !media.allowed(b)) return false;
    const first = new URL(a), second = new URL(b);
    return first.pathname === second.pathname || first.pathname.split('/').pop() === second.pathname.split('/').pop();
  };
  const matchesVisible = item => [...item.urls, ...item.images].some(url => sameAsset(url, source) || sameAsset(url, poster));
  const finish = (item, via) => ({
    ...item, group: item.id || options.group || `media-${Date.now()}`,
    username: item.username || options.username || 'instagram', via,
    // Drop only byte-range parameters. The original signed CDN parameters remain intact.
    assets: item.slides?.length ? item.slides.map(slide => finish(slide, via)) : undefined,
    urls: [...new Set(item.urls.map(value => {
      const url = new URL(value);
      url.searchParams.delete('bytestart'); url.searchParams.delete('byteend');
      return url.href;
    }))]
  });
  const lookup = () => {
    if (!story && options.group) {
      const post = [...media.items.values()].reverse().find(item => item.shortcode === options.group || item.id === options.group);
      if (post) return post;
    }
    if (selectedId && media.items.has(selectedId)) return media.items.get(selectedId);
    return [...media.items.values()].reverse().find(item => item.kind === kind && matchesVisible(item));
  };
  const cached = lookup();
  if (cached && !options.currentStory) return finish(cached, 'session-response');

  // A hard navigation may deliver the full carousel in initial page JSON.
  const readInitial = () => {
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      if (/video_versions|video_url|progressive_urls|image_versions2|display_url/.test(script.textContent || '')) media.parseText(script.textContent);
    }
    return lookup();
  };
  const initial = options.currentStory ? null : readInitial();
  if (initial && !options.currentStory) return finish(initial, 'initial-page-response');

  // Page-created React properties are visible here because this function runs in MAIN.
  // Walk the active element's ancestors, never React siblings or a preloaded viewer subtree.
  const playerIds = new Set();
  let nearest = null;
  const examine = root => {
    const seen = new Set(), queue = [{node: root, depth: 0}], found = [];
    for (let index = 0; index < queue.length && index < 2500; index++) {
      const {node, depth} = queue[index];
      if (!node || typeof node !== 'object' || seen.has(node) || depth > 9 || node instanceof Element) continue;
      seen.add(node);
      const item = media.fromNode(node);
      if (item && (item.kind === kind || !story && item.shortcode === options.group)) found.push(item);
      for (const [key, value] of Object.entries(node)) {
        if (/^(videoID|videoId|video_id|mediaId|media_id|storyMediaId)$/i.test(key) && /^[1-9]\d{8,}(?:_\d+)?$/.test(String(value))) playerIds.add(media.canonicalId(value));
        if (kind === 'video' && /^(src|url|videoUrl|videoURL|progressiveUrl|progressive_url)$/i.test(key) && media.allowed(value) && /\.mp4(?:\?|$)/i.test(value)) found.push({id: '', kind, urls: [value], images: [], username: ''});
        if (value && typeof value === 'object' && !['children', 'child', 'sibling', 'return', 'alternate', 'stateNode', '_owner'].includes(key)) queue.push({node: value, depth: depth + 1});
      }
    }
    return found;
  };
  for (let element = active, level = 0; element && level < 8; element = element.parentElement, level++) {
    const candidates = [];
    for (const key of Object.keys(element)) {
      if (key.startsWith('__reactProps$')) candidates.push(...examine(element[key]));
      if (key.startsWith('__reactFiber$')) {
        let fiber = element[key];
        for (let depth = 0; fiber && depth < 16; fiber = fiber.return, depth++) {
          candidates.push(...examine(fiber.memoizedProps), ...examine(fiber.memoizedState));
          const exact = candidates.find(item => selectedId && item.id === selectedId || !story && item.shortcode === options.group || matchesVisible(item));
          if (exact) return finish(exact, 'page-player');
          if (!nearest && candidates.length) {
            const unique = candidates.filter((item, index) => !candidates.slice(0, index).some(previous => item.urls.some(url => previous.urls.includes(url))));
            if (unique.length === 1) nearest = unique[0];
            if (nearest && options.currentStory) return finish(nearest, 'page-player');
          }
        }
      }
    }
    const exact = candidates.find(item => selectedId && item.id === selectedId || !story && item.shortcode === options.group || matchesVisible(item));
    if (exact) return finish(exact, 'page-player');
    if (!nearest && candidates.length) {
      const unique = candidates.filter((item, index) => !candidates.slice(0, index).some(previous => item.urls.some(url => previous.urls.includes(url))));
      if (unique.length === 1) nearest = unique[0];
      if (nearest && options.currentStory) return finish(nearest, 'page-player');
    }
  }
  const playerId = selectedId || (playerIds.size === 1 ? [...playerIds][0] : '');
  if (playerIds.has(playerId) && media.items.has(playerId)) return finish(media.items.get(playerId), 'player-session-match');
  if (nearest && (!selectedId || !nearest.id || nearest.id === selectedId)) return finish(nearest, 'page-player');

  if (cached) return finish(cached, 'session-response');
  if (initial) return finish(initial, 'initial-page-response');
  if (options.currentStory) {
    const pageMedia = readInitial();
    if (pageMedia) return finish(pageMedia, 'initial-page-response');
  }

  if (media.allowed(source)) return finish({id: selectedId, kind, urls: [source], images: [], username: ''}, 'visible-source');
  throw new Error(`The visible ${kind} could not be matched to the player or session responses (${media.items.size} media records). No file was saved.`);
  } catch (error) { return {error: error?.message || 'The Instagram viewer could not be read.'}; }
}
