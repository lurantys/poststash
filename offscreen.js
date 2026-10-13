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
  for (const value of message.urls || []) {
    try {
      const url = new URL(value);
      const hosts = message.platform === 'tiktok' ? ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com'] : ['instagram.com', 'cdninstagram.com', 'cdninstagram.net', 'fbcdn.net'];
      const allowed = hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
      if (url.protocol !== 'https:' || !allowed) throw new Error('The media URL is outside the supported media hosts.');
      const response = await fetch(url.href, {credentials: 'include', signal: AbortSignal.timeout(120000)});
      if (!response.ok) throw new Error(`Media server returned HTTP ${response.status}.`);
      const buffer = await response.arrayBuffer();
      const range = response.headers.get('content-range');
      if (response.status === 206 && (!range || !/^bytes 0-\d+\/\d+$/.test(range) || Number(range.split('/')[1]) !== buffer.byteLength)) throw new Error('Media server returned only part of the file.');
      const length = Number(response.headers.get('content-length'));
      if (length && !response.headers.get('content-encoding') && length !== buffer.byteLength) throw new Error('The media response was truncated.');
      const format = inspectMediaFile(buffer, message.kind);
      const blob = new Blob([buffer], {type: format.mime});
      const blobUrl = URL.createObjectURL(blob), token = crypto.randomUUID();
      const timer = setTimeout(() => { URL.revokeObjectURL(blobUrl); preparedFiles.delete(token); }, 10 * 60 * 1000);
      preparedFiles.set(token, {url: blobUrl, timer});
      return {ok: true, token, url: blobUrl, bytes: blob.size, ext: format.ext};
    } catch (error) { errors.push(error.message); }
  }
  throw new Error(errors[0] || 'No complete media source was available in the viewer.');
}
