// MAIN: retain YouTube streams already delivered to this tab and freeze the clicked video.
// The player resolves its own signed URLs; the extension only keeps what the tab received.
(() => {
  if (window.__poststashYouTube) return;
  const items = new Map(), clicks = new Map();
  const allowedStream = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com')); }
    catch { return false; }
  };
  const VIDEO_HEIGHT = {313: 2160, 401: 1080, 137: 1080, 248: 1080, 271: 1080, 400: 720, 136: 720, 247: 720, 399: 720, 135: 480, 244: 480, 398: 480, 134: 360, 243: 360, 397: 360, 133: 240, 242: 240, 396: 240, 160: 144, 395: 144};
  const AUDIO_BITRATE = {141: 256000, 251: 160000, 140: 128000, 250: 70000, 249: 50000};
  const validId = value => /^[A-Za-z0-9_-]{11}$/.test(String(value || ''));
  function routeVideoId() {
    try {
      const url = new URL(location.href);
      if (/\/live(?:\/|$)/.test(url.pathname)) return '';
      const param = url.searchParams.get('v');
      if (validId(param)) return param;
      const pathId = url.pathname.match(/^\/(?:shorts|embed|v)\/([A-Za-z0-9_-]{11})/)?.[1];
      if (validId(pathId)) return pathId;
    } catch {}
    return '';
  }
  function entry(id) {
    let item = items.get(id);
    if (!item) { item = {id, tracks: new Map()}; items.set(id, item); }
    return item;
  }
  function noteStream(raw, videoId = routeVideoId()) {
    if (typeof raw !== 'string' || !raw.includes('googlevideo.com') || !raw.includes('/videoplayback')) return;
    if (!allowedStream(raw)) return;
    const id = videoId;
    if (!validId(id)) return;
    let url;
    try { url = new URL(raw); } catch { return; }
    const itag = Number(url.searchParams.get('itag') || 0);
    if (!itag) return;
    url.searchParams.delete('range'); url.searchParams.delete('rn'); url.searchParams.delete('rbuf');
    const mime = url.searchParams.get('mime') || '';
    const isAudio = /^audio\//.test(mime) || (AUDIO_BITRATE[itag] > 0 && !(VIDEO_HEIGHT[itag] > 0));
    const item = entry(id);
    item.tracks.set(itag, {itag, url: url.href, mime, height: VIDEO_HEIGHT[itag] || 0, bitrate: AUDIO_BITRATE[itag] || 0, isAudio});
    while (items.size > 200) items.delete(items.keys().next().value);
  }
  function pageData() {
    const details = window.ytInitialPlayerResponse?.videoDetails;
    if (!details || !validId(details.videoId)) return null;
    const thumbs = [...(details.thumbnail?.thumbnails || [])]
      .filter(thumb => typeof thumb?.url === 'string' && /^(https:)?\/\//.test(thumb.url))
      .map(thumb => ({url: thumb.url.startsWith('http') ? thumb.url : `https:${thumb.url}`, width: Number(thumb.width) || 0}))
      .sort((a, b) => b.width - a.width);
    return {id: details.videoId, title: details.title || details.videoId, author: details.author || 'youtube', thumbs: thumbs.map(thumb => thumb.url)};
  }
  function rememberPlayer(payload) {
    const queue = [payload], seen = new Set();
    for (let index = 0; index < queue.length && index < 20000; index++) {
      const node = queue[index];
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const details = node.videoDetails;
      if (details && validId(details.videoId)) {
        const id = String(details.videoId);
        const item = entry(id);
        item.details = details;
        if (node.streamingData?.serverAbrStreamingUrl) {
          item.webSabrUrl = node.streamingData.serverAbrStreamingUrl;
          item.webFormats = node.streamingData.adaptiveFormats || [];
        }
        for (const format of node.streamingData?.adaptiveFormats || []) {
          if (!/^audio\//.test(format.mimeType || '') || !allowedStream(format.url)) continue;
          const url = new URL(format.url);
          url.searchParams.delete('range');
          item.tracks.set(Number(format.itag), {itag: Number(format.itag), url: url.href, mime: format.mimeType, height: 0, bitrate: Number(format.bitrate) || 0, isAudio: true});
        }
      }
      for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
    }
  }
  function bestVideo(item) {
    const videos = [...item.tracks.values()].filter(track => !track.isAudio && track.height > 0);
    videos.sort((a, b) => b.height - a.height || Number(/mp4/i.test(b.mime)) - Number(/mp4/i.test(a.mime)));
    return videos[0] || null;
  }
  function bestAudio(item) {
    const audios = [...item.tracks.values()].filter(track => track.isAudio);
    audios.sort((a, b) => b.bitrate - a.bitrate || Number(/mp4/i.test(b.mime)) - Number(/mp4/i.test(a.mime)));
    return audios[0] || null;
  }
  function current() {
    if (/\/live(?:\/|$)/.test(location.pathname)) return null;
    const id = routeVideoId();
    if (!id) return null;
    const video = location.pathname.startsWith('/shorts/')
      ? [...document.querySelectorAll('ytd-reel-video-renderer video')].find(element => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 90 && rect.top < innerHeight && rect.bottom > 0;
      })
      : document.querySelector('#movie_player video, #player video');
    if (!video) return null;
    const rect = video.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 90) return null;
    return {element: video, id};
  }
  function snapshot(id) {
    const active = current();
    if (!active || active.id !== id) return {error: 'The video changed. Use the download button in the current player.'};
    refresh();
    const item = items.get(id);
    const details = item?.details;
    if (details?.isLive) return {error: 'Audio downloads are not available for live broadcasts.'};
    const initial = pageData();
    const data = details ? {author: details.author, title: details.title, thumbs: [...(details.thumbnail?.thumbnails || [])].sort((a, b) => (b.width || 0) - (a.width || 0)).map(thumb => thumb.url)} : initial?.id === id ? initial : null;
    const video = item ? bestVideo(item) : null;
    const audio = item ? bestAudio(item) : null;
    const assets = [];
    if (video) assets.push({kind: 'video', urls: [video.url], label: `${video.height}p`, ext: /webm/i.test(video.mime) ? 'webm' : 'mp4'});
    if (audio) assets.push({kind: 'audio', urls: [audio.url], label: audio.bitrate ? `${Math.round(audio.bitrate / 1000)}k` : 'audio', ext: /webm/i.test(audio.mime) ? 'webm' : 'm4a'});
    return {
      id, group: id,
      username: data?.author || 'youtube', title: data?.title || id, kind: 'youtube',
      thumb: data?.thumbs?.length ? {kind: 'image', urls: [...data.thumbs]} : null,
      assets,
      sabr: item?.sabr && item.webFormats?.length ? {...item.sabr, videoId: id, formats: item.webFormats} : null
    };
  }
  function refresh() {
    try {
      const payload = window.ytInitialPlayerResponse;
      if (payload && typeof payload === 'object') rememberPlayer(payload);
      const player = document.getElementById('movie_player');
      const response = player?.getPlayerResponse?.();
      if (response) rememberPlayer(response);
    } catch {}
    const active = current();
    for (const node of document.querySelectorAll('[data-poststash-yt-active]')) if (node !== active?.element) node.removeAttribute('data-poststash-yt-active');
    if (active && active.element.getAttribute('data-poststash-yt-active') !== active.id) active.element.setAttribute('data-poststash-yt-active', active.id);
  }
  const capturePlayer = response => { response.clone().json().then(rememberPlayer).catch(() => {}); };
  function captureSabr(raw, body) {
    if (!allowedStream(raw) || !raw.includes('/videoplayback') || !body) return;
    try {
      const url = new URL(raw);
      if (url.searchParams.get('sabr') !== '1') return;
      const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : null;
      if (!bytes) return;
      const request = PoststashSabr.VideoPlaybackAbrRequest.decode(bytes);
      const config = request.videoPlaybackUstreamerConfig;
      const context = request.streamerContext;
      if (!config?.length || !context?.poToken?.length) return;
      refresh();
      const item = [...items.values()].find(candidate => candidate.webSabrUrl && new URL(candidate.webSabrUrl).searchParams.get('id') === url.searchParams.get('id'));
      if (!item) return;
      const encode = value => btoa(String.fromCharCode(...value));
      item.sabr = {
        serverAbrStreamingUrl: url.href,
        videoPlaybackUstreamerConfig: encode(config),
        poToken: encode(context.poToken), clientInfo: context.clientInfo
      };
    } catch {}
  }
  // Media-element requests can bypass fetch and XHR.
  try {
    new PerformanceObserver(list => {
      for (const resource of list.getEntries()) noteStream(resource.name);
    }).observe({type: 'resource'});
  } catch {}
  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const raw = input instanceof Request ? input.url : String(input);
    if (raw.includes('googlevideo.com')) {
      if (input instanceof Request) input.clone().arrayBuffer().then(body => captureSabr(raw, body)).catch(() => {});
      else captureSabr(raw, init?.body);
    }
    if (raw.includes('googlevideo.com') && raw.includes('/videoplayback')) { try { noteStream(raw); } catch {} }
    const result = nativeFetch.call(this, input, init);
    if (/youtubei\/v\d+\/player/.test(raw)) result.then(capturePlayer).catch(() => {});
    return result;
  };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const raw = String(url);
    if (raw.includes('googlevideo.com') && raw.includes('/videoplayback')) { try { noteStream(raw); } catch {} }
    this.__poststashYouTubePlayer = /youtubei\/v\d+\/player/.test(raw);
    this.__poststashYouTubeUrl = raw;
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    captureSabr(this.__poststashYouTubeUrl || '', args[0]);
    if (this.__poststashYouTubePlayer) this.addEventListener('load', () => {
      try { rememberPlayer(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {}
    }, {once: true});
    return send.apply(this, args);
  };
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const host = target?.closest('[data-poststash-youtube-button]');
    if (!host) return;
    const clickId = crypto.randomUUID();
    clicks.set(clickId, {id: host.dataset.videoId});
    host.dataset.clickId = clickId;
    while (clicks.size > 24) clicks.delete(clicks.keys().next().value);
    setTimeout(() => clicks.delete(clickId), 60000);
  }, true);
  window.__poststashYouTube = {items, clicks, noteStream, rememberPlayer, current, snapshot, routeVideoId};
  document.addEventListener('yt-navigate-finish', refresh, true);
  for (const event of ['scroll', 'resize', 'popstate']) window.addEventListener(event, refresh, true);
  setInterval(refresh, 500);
  refresh();
})();
