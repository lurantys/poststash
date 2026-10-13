const preparedFiles = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message?.target !== 'poststash-offscreen') return;
  if (message.type === 'release-media-file') {
    const entry = preparedFiles.get(message.token);
    if (entry) { clearTimeout(entry.timer); URL.revokeObjectURL(entry.url); preparedFiles.delete(message.token); }
    sendResponse({ok: true});
    return;
  }
  if (message.type !== 'prepare-media-file') return;
  prepareMediaFile(message).then(sendResponse).catch(error => sendResponse({ok: false, message: error.message}));
  return true;
});

async function prepareMediaFile(message) {
  const errors = [];
  const sabr = message.platform === 'youtube' && message.kind === 'audio' ? message.sabr : null;
  for (const value of sabr ? [sabr.serverAbrStreamingUrl] : message.urls || []) {
    try {
      const url = new URL(value);
      const hosts = message.platform === 'tiktok' ? ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com'] : message.platform === 'x' ? ['pbs.twimg.com', 'video.twimg.com'] : message.platform === 'youtube' ? ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com'] : ['instagram.com', 'cdninstagram.com', 'cdninstagram.net', 'fbcdn.net'];
      const allowed = hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
      if (url.protocol !== 'https:' || !allowed) throw new Error('The media URL is outside the supported media hosts.');
      let buffer;
      const audioRange = message.platform === 'youtube' && message.kind === 'audio' && url.searchParams.get('range')?.match(/^0-(\d+)$/);
      if (sabr) {
        buffer = await fetchYouTubeSabr(sabr);
      } else if (audioRange) {
        buffer = await fetchYouTubeAudio(url, Number(audioRange[1]) + 1);
      } else {
        const response = await fetch(url.href, {credentials: message.platform === 'youtube' ? 'omit' : 'include', signal: AbortSignal.timeout(120000)});
        if (!response.ok) throw new Error(`Media server returned HTTP ${response.status}.`);
        buffer = await response.arrayBuffer();
        const range = response.headers.get('content-range');
        if (response.status === 206 && (!range || !/^bytes 0-\d+\/\d+$/.test(range) || Number(range.split('/')[1]) !== buffer.byteLength)) throw new Error('Media server returned only part of the file.');
        const length = Number(response.headers.get('content-length'));
        if (length && !response.headers.get('content-encoding') && length !== buffer.byteLength) throw new Error('The media response was truncated.');
      }
      const format = inspectMediaFile(buffer, message.kind);
      const mime = message.kind === 'audio' && format.ext === 'm4a' ? 'audio/x-m4a' : format.mime;
      const blob = new Blob([buffer], {type: mime});
      const blobUrl = URL.createObjectURL(blob), token = crypto.randomUUID();
      const timer = setTimeout(() => { URL.revokeObjectURL(blobUrl); preparedFiles.delete(token); }, 10 * 60 * 1000);
      preparedFiles.set(token, {url: blobUrl, timer});
      return {ok: true, token, url: blobUrl, bytes: blob.size, ext: format.ext};
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(errors[0] || 'No complete media source was available in the viewer.');
}

async function fetchYouTubeSabr(config) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(config.videoId || '')) throw new Error('The audio stream is missing its video ID.');
  const stream = new PoststashSabr.SabrStream({
    ...config, formats: config.formats.map(PoststashSabr.buildSabrFormat),
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com')) throw new Error('YouTube redirected the audio outside its media servers.');
      return fetch(input, {...init, credentials: 'omit'});
    }
  });
  let audioTrack;
  stream.on('formatInitialization', track => {
    if (/^audio\//.test(track.formatInitializationMetadata.mimeType || '')) audioTrack = track;
  });
  const timeout = setTimeout(() => stream.abort(), 5 * 60 * 1000);
  try {
    const {audioStream, selectedFormats} = await stream.start({
      enabledTrackTypes: PoststashSabr.EnabledTrackTypes.AUDIO_ONLY,
      preferMP4: true,
      isPostLiveDvr: false, maxRetries: 2, stallDetectionMs: 10000
    });
    const chunks = [];
    let length = 0;
    const reader = audioStream.getReader();
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 512 * 1024 * 1024) throw new Error('This audio file is too large to download in the extension.');
      chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    const duration = selectedFormats.audioFormat.approxDurationMs;
    const segments = audioTrack?.downloadedSegments;
    const lastSegment = Number(audioTrack?.formatInitializationMetadata.endSegmentNumber);
    const downloadedDuration = segments ? [...segments.values()].reduce((sum, segment) => sum + Number(segment.durationMs || 0), 0) : 0;
    if (!segments || !Number.isSafeInteger(lastSegment) || !duration || downloadedDuration < duration - 1000) throw new Error('YouTube returned only part of the audio. Please retry.');
    for (let index = 0; index <= lastSegment; index++) {
      if (!segments.has(index)) throw new Error('YouTube returned only part of the audio. Please retry.');
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } catch (error) {
    await stream.abort();
    throw error;
  } finally { clearTimeout(timeout); }
}

async function fetchYouTubeAudio(url, size) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > 512 * 1024 * 1024) throw new Error('This audio file is too large to download in the extension.');
  const bytes = new Uint8Array(size);
  const chunkSize = 1024 * 1024;
  for (let start = 0; start < size; start += chunkSize) {
    const end = Math.min(size - 1, start + chunkSize - 1);
    const chunkUrl = new URL(url.href);
    // Googlevideo requires query byte ranges, including for complete file downloads.
    chunkUrl.searchParams.set('range', `${start}-${end}`);
    const response = await fetch(chunkUrl.href, {credentials: 'omit', signal: AbortSignal.timeout(120000)});
    if (!response.ok) throw new Error(`Media server returned HTTP ${response.status}.`);
    const chunk = new Uint8Array(await response.arrayBuffer());
    if (chunk.byteLength !== end - start + 1) throw new Error('YouTube returned an incomplete audio chunk. Please retry.');
    const range = response.headers.get('content-range');
    if (response.status === 206 && range !== `bytes ${start}-${end}/${size}`) throw new Error('YouTube returned the wrong audio byte range. Please retry.');
    bytes.set(chunk, start);
  }
  return bytes.buffer;
}
