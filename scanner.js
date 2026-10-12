// Uses Instagram's authenticated web endpoints from the signed-in tab. This
// keeps pagination and media collection off the visible page.
async function scanPage(mode, options = {}) {
  const report = (stage, details = {}) => window.postMessage({source: 'ig-saver', type: 'progress', stage, ...details}, location.origin);
  const segments = location.pathname.split('/').filter(Boolean);
  const first = (segments[0] || '').toLowerCase();
  const reserved = new Set(['', 'about', 'accounts', 'developer', 'direct', 'emails', 'explore', 'legal', 'p', 'privacy', 'reel', 'reels', 'stories', 'tv', 'web'] );
  const requestedUser = typeof options.username === 'string' && /^[a-z0-9._]{1,30}$/i.test(options.username) ? options.username : '';
  const requestedHighlightId = typeof options.highlightId === 'string' && /^\d+$/.test(options.highlightId) ? options.highlightId : '';
  if ((!requestedUser && segments.length !== 1) || (reserved.has(first) && !requestedUser)) {
    return {items: [], urls: [], username: 'instagram', message: 'Open the account profile itself before downloading.'};
  }
  const user = requestedUser || segments[0];
  const targetUsername = user.toLowerCase();
  const state = window.__igSaverCapture;
  if (!state?.records) return {items: [], urls: [], username: user, message: 'Reload this Instagram profile once, then start the download again.'};

  const collected = new Map();
  const groupDates = new Map();
  const profileIds = new Set();
  const highlightIds = new Set();
  const findStoryIds = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 35) return;
    if (Array.isArray(node)) { node.forEach(item => findStoryIds(item, depth + 1)); return; }
    if (typeof node.username === 'string' && node.username.toLowerCase() === targetUsername) {
      const id = node.pk || node.id || node.pk_id;
      if (id) profileIds.add(String(id));
      const edges = node.edge_highlight_reels?.edges || node.highlight_reels?.edges || [];
      for (const edge of edges) {
        const highlight = edge?.node || edge;
        const highlightId = highlight?.id || highlight?.pk;
        if (highlightId) highlightIds.add(String(highlightId).replace(/^highlight:/, ''));
      }
      for (const highlight of node.highlights?.items || []) {
        const highlightId = highlight?.id || highlight?.pk;
        if (highlightId) highlightIds.add(String(highlightId).replace(/^highlight:/, ''));
      }
    }
    Object.values(node).forEach(value => findStoryIds(value, depth + 1));
  };
  const add = (url, kind, group = 'media', slide = 1, category = 'posts') => {
    if (!url || typeof url !== 'string' || !/^https?:/.test(url)) return;
    try {
      const parsed = new URL(url);
      if ((parsed.hostname.endsWith('instagram.com') || parsed.hostname.endsWith('cdninstagram.net') || parsed.hostname.endsWith('fbcdn.net')) && !collected.has(parsed.href)) {
        collected.set(parsed.href, {url: parsed.href, kind, group: String(group), slide, category});
      }
    } catch {}
  };
  const mediaLike = media => media && typeof media === 'object' &&
    (media.image_versions2 || media.video_versions || media.video_url || media.display_url);
  const addMedia = (media, group, slide, category) => {
    if (!mediaLike(media)) return;
    const video = media.video_url || [...(media.video_versions || [])]
      .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0]?.url;
    if (video) { add(video, 'video', group, slide, category); return; }
    const candidates = media.image_versions2?.candidates || media.image_versions?.candidates || [];
    const best = [...candidates].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
    add(best?.url || media.display_url || media.thumbnail_src, 'image', group, slide, category);
  };
  const addPost = (media, context = 'posts') => {
    let category = context;
    if (category === 'posts' && (media.product_type === 'clips' || media.is_reel === true || media.media_type === 2 && media.product_type === 'clips')) category = 'reels';
    if (media.reel_type === 'highlight' || media.reel_type === 'archive' && context === 'highlight') category = 'highlights';
    const group = category === 'highlights' || category === 'stories'
      ? media.pk || media.id || media.code || media.shortcode || 'story'
      : media.code || media.shortcode || media.pk || media.id || 'post';
    const timestamp = Number(media.taken_at_timestamp ?? media.taken_at ?? media.timestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) groupDates.set(String(group), timestamp > 1e12 ? timestamp : timestamp * 1000);
    const carousel = media.carousel_media || media.edge_sidecar_to_children?.edges?.map(edge => edge.node);
    if (carousel?.length) carousel.forEach((slide, index) => addMedia(slide, group, index + 1, category));
    else addMedia(media, group, 1, category);
  };
  const ownerName = media => {
    const name = media?.owner?.username || media?.user?.username || media?.owner_username;
    return typeof name === 'string' ? name.toLowerCase() : null;
  };
  const visit = (node, context = 'posts', depth = 0, targetScope = false) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) { node.forEach(item => visit(item, context, depth + 1, targetScope)); return; }
    const owner = ownerName(node);
    const scoped = typeof node.username === 'string' ? node.username.toLowerCase() === targetUsername : owner ? owner === targetUsername : targetScope;
    if (mediaLike(node) && (owner ? owner === targetUsername : scoped)) addPost(node, context);
    for (const [key, value] of Object.entries(node)) {
      const nextContext = /highlight/i.test(key) ? 'highlights'
        : context === 'highlights' ? 'highlights'
        : context === 'stories' ? 'stories'
        : /story|reels_media|reel_media|reel_timeline|^reel$/i.test(key) ? 'stories'
        : /reels|clips|felix/i.test(key) ? 'reels' : context;
      const isUserBoundary = /^(owner|user|author|user_info|owner_info)$/i.test(key);
      visit(value, nextContext, depth + 1, isUserBoundary ? false : scoped);
    }
  };
  const findConnections = (node, found = [], depth = 0, targetScope = false) => {
    if (!node || typeof node !== 'object' || depth > 40) return found;
    if (Array.isArray(node)) { node.forEach(value => findConnections(value, found, depth + 1, targetScope)); return found; }
    const scoped = typeof node.username === 'string' ? node.username.toLowerCase() === targetUsername : targetScope;
    const targetOwnedEdges = Array.isArray(node.edges) && node.edges.length > 0 && node.edges.every(edge => {
      const media = edge?.node;
      return mediaLike(media) && ownerName(media) === targetUsername;
    });
    if (Array.isArray(node.edges) && node.page_info && node.edges.some(edge => mediaLike(edge?.node)) && (scoped || targetOwnedEdges)) found.push(node);
    for (const [key, value] of Object.entries(node)) {
      const isUserBoundary = /^(owner|user|author|user_info|owner_info)$/i.test(key);
      findConnections(value, found, depth + 1, isUserBoundary ? false : scoped);
    }
    return found;
  };
  const patchAfter = (value, cursor) => {
    if (!value || typeof value !== 'object') return false;
    let patched = false;
    if (Array.isArray(value)) return value.some(item => patchAfter(item, cursor));
    for (const key of Object.keys(value)) {
      if (key === 'after') { value[key] = cursor; patched = true; }
      else if (typeof value[key] === 'object') patched = patchAfter(value[key], cursor) || patched;
    }
    return patched;
  };
  const replayPage = async (request, cursor) => {
    const url = new URL(request.url, location.origin);
    const init = {method: request.method || 'GET', credentials: 'include', headers: request.headers || {}};
    let changed = false;
    const urlVariables = url.searchParams.get('variables');
    if (urlVariables) {
      try {
        const variables = JSON.parse(urlVariables);
        changed = patchAfter(variables, cursor);
        if (changed) url.searchParams.set('variables', JSON.stringify(variables));
      } catch {}
    }
    if (request.body) {
      const params = new URLSearchParams(request.body);
      const bodyVariables = params.get('variables');
      if (bodyVariables) {
        try {
          const variables = JSON.parse(bodyVariables);
          changed = patchAfter(variables, cursor) || changed;
          if (changed) params.set('variables', JSON.stringify(variables));
        } catch {}
        init.body = params.toString();
      } else {
        try {
          const body = JSON.parse(request.body);
          changed = patchAfter(body, cursor) || changed;
          init.body = JSON.stringify(body);
        } catch { init.body = request.body; }
      }
    } else if (url.searchParams.has('after')) {
      url.searchParams.set('after', cursor);
      changed = true;
    }
    if (!changed) return null;
    const response = await state.originalFetch(url.href, init);
    if (response.status === 429) return {rateLimited: true};
    if (!response.ok) return {error: `Instagram pagination returned HTTP ${response.status}.`};
    return {payload: await response.json()};
  };

  let records = state.records.slice();
  const warnings = [];
  const requestCategory = request => {
    const url = String(request?.url || '').toLowerCase();
    if (/highlight/.test(url)) return 'highlights';
    if (/reels_media|reel_media|stories/.test(url)) return 'stories';
    if (/clips|reel/.test(url)) return 'reels';
    return 'posts';
  };
  records.forEach(record => findStoryIds(record.payload));
  if (!requestedHighlightId) records.forEach(record => visit(record.payload, requestCategory(record.request)));
  else records.forEach(record => {
    const request = record.request || {};
    let requestText = `${request.url || ''} ${request.body || ''}`;
    try { requestText = decodeURIComponent(requestText); } catch {}
    if (requestText.includes(requestedHighlightId) && /highlight|reels?_media|graphql/i.test(requestText))
      visit(record.payload, 'highlights', 0, true);
  });
  const seenCursors = new Set();
  const templates = [];
  let pages = 0;
  const categories = Array.isArray(options.categories) && options.categories.length
    ? new Set(options.categories.filter(category => ['posts', 'reels', 'stories', 'highlights'].includes(category)))
    : new Set(['posts', 'reels']);
  const postLimit = categories.has('posts') || categories.has('reels')
    ? Math.min(10000, Math.max(0, Number(options.limit) || 0)) : 0;
  const countedGroups = () => new Set([...collected.values()].filter(item => categories.has(item.category) && ['posts', 'reels'].includes(item.category)).map(item => item.group)).size;
  const singleFound = () => options.group && [...collected.values()].some(item => item.group === String(options.group) && (categories.has(item.category) || categories.has('reels') && item.category === 'posts'));
  for (const record of records) {
    for (const connection of findConnections(record.payload)) {
      if (connection.page_info?.has_next_page && connection.page_info?.end_cursor) {
        templates.push({request: record.request, cursor: connection.page_info.end_cursor, category: requestCategory(record.request)});
      }
    }
  }
  const needsStoryMetadata = () => categories.has('stories') && !profileIds.size || categories.has('highlights') && !highlightIds.size && !requestedHighlightId;
  if (!requestedHighlightId && (!collected.size || needsStoryMetadata() || options.group && !singleFound())) {
    for (let wait = 0; wait < 20 && (!collected.size || needsStoryMetadata() || options.group && !singleFound()); wait++) {
      report('waiting', {pages: 0, items: 0});
      await new Promise(resolve => setTimeout(resolve, 500));
      const newer = state.records.slice(records.length);
      if (!newer.length) continue;
      records = records.concat(newer);
      newer.forEach(record => findStoryIds(record.payload));
      if (!requestedHighlightId) newer.forEach(record => visit(record.payload, requestCategory(record.request)));
      for (const record of newer) {
        for (const connection of findConnections(record.payload)) {
          if (connection.page_info?.has_next_page && connection.page_info?.end_cursor)
            templates.push({request: record.request, cursor: connection.page_info.end_cursor, category: requestCategory(record.request)});
        }
      }
    }
  }
  if (categories.has('stories') || categories.has('highlights')) {
    const headers = {};
    for (const record of records) {
      for (const [key, value] of Object.entries(record.request?.headers || {})) {
        if (/^(x-ig-app-id|x-asbd-id|x-ig-www-claim|x-csrftoken|x-requested-with)$/i.test(key)) headers[key] = value;
      }
    }
    headers['x-ig-app-id'] ||= '936619743392459';
    headers['x-ig-www-claim'] ||= '0';
    headers['x-requested-with'] ||= 'XMLHttpRequest';
    try {
      const config = window.require?.('PolarisConfig');
      const claim = window.require?.('PolarisWWWClaim');
      headers['x-ig-app-id'] = String(config?.getIGAppID?.() || headers['x-ig-app-id']);
      headers['x-ig-www-claim'] = String(claim?.getWWWClaim?.() || sessionStorage.getItem('www-claim-v2') || headers['x-ig-www-claim']);
    } catch {}
    const pageApi = (() => {
      try { return typeof window.require === 'function' ? window.require('PolarisInstapi') : null; }
      catch { return null; }
    })();
    const instagramApiGet = async (path, query = {}, forcePageFetch = false) => {
      if (!forcePageFetch && typeof pageApi?.apiGet === 'function') {
        const result = await pageApi.apiGet(path, {query});
        return result?.data ?? result;
      }
      const endpoint = new URL(path, location.origin);
      for (const [key, value] of Object.entries(query)) if (value != null && value !== '') endpoint.searchParams.set(key, value);
      const response = await state.originalFetch(endpoint.href, {method: 'GET', credentials: 'include', headers});
      if (response.status === 429) throw new Error('Instagram rate-limited story retrieval (HTTP 429). Try again later.');
      if (!response.ok) throw new Error(`Instagram request failed (HTTP ${response.status}).`);
      return response.json();
    };
    const lookupProfileId = async () => {
      const payload = await instagramApiGet('/api/v1/users/web_profile_info/', {username: targetUsername});
      const id = payload?.data?.user?.id || payload?.user?.id || payload?.graphql?.user?.id;
      return id ? String(id) : '';
    };
    if (!headers['x-csrftoken'] && !headers['X-CSRFToken']) {
      const csrf = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('csrftoken='));
      if (csrf) headers['x-csrftoken'] = decodeURIComponent(csrf.slice('csrftoken='.length));
    }
    const fetchReel = async (id, category, mediaId = '') => {
      let payload;
      try { payload = await instagramApiGet('/api/v1/feed/reels_media/', {reel_ids: id, media_id: /^[1-9]\d*$/.test(mediaId) ? mediaId : ''}); }
      catch (error) { warnings.push(`${category} retrieval failed: ${error?.message || 'Instagram request failed'}.`); return !/429/.test(error?.message || ''); }
      if (!payload?.reels_media?.length && !payload?.reels?.[id] && typeof pageApi?.apiGet === 'function') {
        try {
          const fallback = await instagramApiGet('/api/v1/feed/reels_media/', {reel_ids: id, media_id: /^[1-9]\d*$/.test(mediaId) ? mediaId : ''}, true);
          if (fallback?.reels_media?.length || fallback?.reels?.[id]) payload = fallback;
        } catch (error) { warnings.push(`${category} page request failed: ${error?.message || 'Instagram request failed'}.`); }
      }
      if (!payload?.reels_media?.length && !payload?.reels?.[id]) {
        const detail = payload?.message || payload?.error || payload?.status;
        if (detail && detail !== 'ok') warnings.push(`Instagram did not return ${category} media: ${String(detail).slice(0, 160)}.`);
      }
      visit(payload, category, 0, true);
      return true;
    };
    if (categories.has('stories')) {
      if (!profileIds.size) {
        try { const id = await lookupProfileId(); if (id) profileIds.add(id); }
        catch (error) { warnings.push(`Could not identify the Story account: ${error?.message || 'profile lookup failed'}.`); }
      }
      if (profileIds.size) {
        for (const id of profileIds) if (!await fetchReel(id, 'stories', options.group || '')) break;
      } else warnings.push('Instagram did not provide the account ID needed to look up this Story.');
    }
    if (categories.has('highlights')) {
      const requestedHighlightIds = requestedHighlightId ? [requestedHighlightId] : [...highlightIds];
      if (requestedHighlightIds.length) {
        for (const id of requestedHighlightIds) {
          try { if (!await fetchReel(`highlight:${id}`, 'highlights', options.group || '')) break; }
          catch (error) { warnings.push(`Highlight retrieval stopped: ${error?.message || 'request failed'}.`); break; }
        }
      } else warnings.push('Instagram did not expose highlight IDs for this profile.');
    }
  }
  for (const template of requestedHighlightId ? [] : templates) {
    let cursor = template.cursor;
    for (let page = 0; page < 500 && cursor && !seenCursors.has(cursor) && (!postLimit || countedGroups() < postLimit) && (!options.group || !singleFound()); page++) {
      seenCursors.add(cursor);
      try {
        await new Promise(resolve => setTimeout(resolve, 900));
        const result = await replayPage(template.request, cursor);
        pages++;
        report('scanning', {pages, items: collected.size});
        if (result?.rateLimited) {
          warnings.push('Instagram rate-limited pagination (HTTP 429). Wait a while before trying again.');
          cursor = null;
          break;
        }
        if (result?.error) {
          warnings.push(result.error);
          break;
        }
        const payload = result?.payload;
        if (!payload) break;
        visit(payload, template.category);
        if (options.group && singleFound()) break;
        if (postLimit && countedGroups() >= postLimit) break;
        const next = findConnections(payload).find(connection => connection.page_info?.end_cursor)?.page_info;
        if (!next?.has_next_page || !next.end_cursor || next.end_cursor === cursor) break;
        cursor = next.end_cursor;
      } catch (error) {
        warnings.push(`Pagination stopped: ${error?.message || 'request failed'}.`);
        break;
      }
    }
  }
  let items = [...collected.values()];
  items = items.filter(item => categories.has(item.category) || (options.group && categories.has('reels') && item.category === 'posts'));
  if (options.group) items = items.filter(item => item.group === String(options.group) || ['stories', 'highlights'].includes(item.category) && String(item.group).split('_')[0] === String(options.group).split('_')[0]);
  if (options.mediaType === 'photos') items = items.filter(item => item.kind === 'image');
  if (options.mediaType === 'videos') items = items.filter(item => item.kind === 'video');
  const from = options.dateFrom ? new Date(`${options.dateFrom}T00:00:00`).getTime() : NaN;
  const through = options.dateTo ? new Date(`${options.dateTo}T23:59:59.999`).getTime() : NaN;
  if (Number.isFinite(from) || Number.isFinite(through)) {
    items = items.filter(item => {
      const date = groupDates.get(item.group);
      return Number.isFinite(date) && (!Number.isFinite(from) || date >= from) && (!Number.isFinite(through) || date <= through);
    });
  }
  if (postLimit) {
    const allowed = new Set([...new Set(items.filter(item => ['posts', 'reels'].includes(item.category)).map(item => item.group))].slice(0, postLimit));
    items = items.filter(item => !['posts', 'reels'].includes(item.category) || allowed.has(item.group));
  }
  for (const type of ['stories', 'highlights']) {
    if (categories.has(type) && ![...collected.values()].some(item => item.category === type))
      warnings.push(`Instagram did not provide any ${type} media to this page session.`);
  }
  report('scanned', {pages, items: items.length});
  return {
    items,
    pages,
    username: user,
    warnings,
    message: collected.size ? 'No downloadable media found.' : 'No media responses were captured. Reload the profile tab with the extension enabled.'
  };
}
