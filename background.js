importScripts('scanner.js', 'viewer.js', 'tiktok-viewer.js');

const reservedRoutes = new Set(['about', 'accounts', 'developer', 'direct', 'emails', 'explore', 'legal', 'p', 'privacy', 'reel', 'reels', 'stories', 'tv', 'web']);
const jobs = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'download-tiktok-video') {
    downloadTikTokVideo(message, sender).then(sendResponse).catch(error => sendResponse({ok: false, message: error.message || 'Could not save this TikTok video.'}));
    return true;
  }
  if (message?.type === 'download-progress' && sender.tab?.id) {
    const job = jobs.get(sender.tab.id);
    if (job && Number.isFinite(message.pages)) Object.assign(job, message);
    return;
  }
  if (message?.type === 'get-download-progress') {
    const tabId = sender.tab?.id ?? message.tabId;
    sendResponse({ok: true, progress: jobs.get(tabId) || null});
    return;
  }
  if (message?.type === 'download-viewer-media') {
    downloadViewerMedia(message, sender).then(sendResponse).catch(error => sendResponse({ok: false, message: error?.message || 'Could not save this media.'}));
    return true;
  }
  if (message?.type !== 'download-profile') return;
  const tabId = sender.tab?.id ?? message.tabId;
  if (jobs.get(tabId) && !['complete', 'error'].includes(jobs.get(tabId).stage)) {
    sendResponse({ok: false, message: 'A download is already running for this profile.'});
    return;
  }
  const job = {tabId, username: '', stage: 'starting', pages: 0, total: null, downloaded: 0, failed: 0};
  jobs.set(tabId, job);
  chrome.tabs.sendMessage(tabId, {type: 'ig-saver-job-started'}).catch(() => {});
  handleProfileDownload(message, sender, job).then(result => {
    Object.assign(job, {stage: 'complete', result, finishedAt: Date.now()});
  }).catch(error => {
    Object.assign(job, {stage: 'error', error: error?.message || 'Could not download this profile.'});
  });
  sendResponse({ok: true, started: true});
});

async function handleProfileDownload(message, sender, job) {
  job.stage = 'scanning';
  const requestedTabId = message.tabId;
  const tabId = sender.tab?.id ?? requestedTabId;
  if (!Number.isInteger(tabId) || (sender.tab && requestedTabId && sender.tab.id !== requestedTabId)) {
    throw new Error('Could not identify the Instagram tab.');
  }
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith('https://www.instagram.com/')) {
    throw new Error('Open an Instagram profile.');
  }
  const url = new URL(tab.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const username = segments[0];
  if (segments.length !== 1 || !username || reservedRoutes.has(username.toLowerCase())) {
    throw new Error('Open the account profile itself.');
  }

  const [{result}] = await chrome.scripting.executeScript({
    target: {tabId},
    world: 'MAIN',
    func: scanPage,
    args: ['profile', {
      limit: Number(message.limit) || 0,
      mediaType: ['all', 'photos', 'videos'].includes(message.mediaType) ? message.mediaType : 'all',
      categories: Array.isArray(message.categories) ? message.categories.filter(category => ['posts', 'reels', 'stories', 'highlights'].includes(category)) : ['posts', 'reels'],
      dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(message.dateFrom || '') ? message.dateFrom : '',
      dateTo: /^\d{4}-\d{2}-\d{2}$/.test(message.dateTo || '') ? message.dateTo : ''
    }]
  });
  if (result?.username?.toLowerCase() !== username.toLowerCase()) {
    throw new Error('The open page is not an account profile.');
  }
  if (!result.items?.length) {
    const warning = result.warnings?.length ? ` ${result.warnings.join(' ')}` : '';
    throw new Error(`${result.message || 'No profile media found.'}${warning}`);
  }

  job.username = username;
  job.stage = 'downloading';
  job.total = result.items.length;
  const pacingMs = 250;
  for (let index = 0; index < result.items.length; index++) {
    const item = result.items[index];
    try {
      await chrome.downloads.download({
        url: item.url,
        filename: `Instagram/${safeName(username)}/${safeName(item.group || 'media')}-${String(item.slide || index + 1).padStart(3, '0')}-${fileName(item.url, index + 1, item.kind).replace(/^\d+-/, '')}`,
        conflictAction: 'uniquify',
        saveAs: false
      });
      job.downloaded++;
    } catch (error) {
      job.failed++;
      if (!job.errors) job.errors = [];
      if (job.errors.length < 5) job.errors.push(`${item.group}: ${error?.message || 'Download could not be started.'}`);
    }
    job.pages = result.pages || job.pages;
    if (index < result.items.length - 1) await new Promise(resolve => setTimeout(resolve, pacingMs));
  }

  const warnings = result.warnings?.length ? ` ${result.warnings.join(' ')}` : '';
  job.message = `Started ${job.downloaded} of ${result.items.length} downloads.${job.failed ? ` ${job.failed} could not be started.` : ''}${job.errors?.length ? ` ${job.errors.join('; ')}` : ''}${warnings}`;
}

let creatingOffscreen;
const fileDownloads = new Map();

async function ensureOffscreen() {
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    const existing = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')]});
    if (!existing.length) await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Fetch, validate, and save complete media files.'});
  })();
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}

async function finishFileDownload(id, state, error) {
  const pending = fileDownloads.get(id);
  if (!pending || !['complete', 'interrupted'].includes(state)) return;
  fileDownloads.delete(id);
  chrome.runtime.sendMessage({target: 'poststash-offscreen', type: 'release-media-file', token: pending.token}).catch(() => {});
  if (state === 'complete') pending.resolve();
  else pending.reject(new Error(`Chrome could not save the file${error ? ` (${error})` : ''}. You can retry the download.`));
}

chrome.downloads.onChanged.addListener(delta => finishFileDownload(delta.id, delta.state?.current, delta.error?.current));

async function saveVerifiedMedia(asset, filenameBase, platform = 'instagram') {
  await ensureOffscreen();
  const file = await chrome.runtime.sendMessage({target: 'poststash-offscreen', type: 'prepare-media-file', urls: asset.urls, kind: asset.kind, platform});
  if (!file?.ok) throw new Error(file?.message || 'Could not prepare a complete media file.');
  try {
    const id = await chrome.downloads.download({url: file.url, filename: `${filenameBase}.${file.ext}`, conflictAction: 'uniquify', saveAs: false});
    await new Promise((resolve, reject) => {
      fileDownloads.set(id, {resolve, reject, token: file.token});
      // A small Blob can complete before download() resolves; inspect the current state too.
      chrome.downloads.search({id}).then(([download]) => finishFileDownload(id, download?.state, download?.error)).catch(error => {
        fileDownloads.delete(id); reject(error);
      });
    });
  } catch (error) {
    chrome.runtime.sendMessage({target: 'poststash-offscreen', type: 'release-media-file', token: file.token}).catch(() => {});
    throw error;
  }
}

async function downloadViewerMedia(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error('Could not identify the Instagram viewer tab.');
  const tab = await chrome.tabs.get(tabId);
  if (new URL(tab.url).origin !== 'https://www.instagram.com') throw new Error('Open the media in Instagram first.');
  const category = ['posts', 'reels', 'stories', 'highlights'].includes(message.category) ? message.category : 'posts';
  const [execution] = await chrome.scripting.executeScript({
    target: {tabId}, world: 'MAIN', func: resolveViewerMedia,
    args: [{category, username: message.username || '', group: message.group || '', storyClickId: message.storyClickId || ''}]
  });
  const result = execution?.result;
  if (result?.error) throw new Error(result.error);
  if (!result || !result.urls?.length && !result.assets?.length) throw new Error('The browser viewer did not return a complete media source.');
  const assets = result.assets || [result];
  let saved = 0;
  for (const [index, asset] of assets.entries()) {
    const filename = `Instagram/${safeName(result.username)}/${category}/${safeName(result.group)}${assets.length > 1 ? `-${String(index + 1).padStart(3, '0')}` : ''}`;
    try { await saveVerifiedMedia(asset, filename); saved++; }
    catch (error) { throw new Error(`${error.message}${saved ? ` ${saved} of ${assets.length} files were saved.` : ''}`); }
  }
  return {ok: true, message: `Saved ${saved} complete media file${saved === 1 ? '' : 's'}.`};
}

async function downloadTikTokVideo(message, sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error('Could not identify the TikTok tab.');
  const tab = await chrome.tabs.get(tabId);
  if (!['https://www.tiktok.com', 'https://tiktok.com'].includes(new URL(tab.url).origin)) throw new Error('Open the video on TikTok first.');
  const [execution] = await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: resolveTikTokVideo, args: [{clickId: message.clickId}]});
  const video = execution?.result;
  if (video?.error) throw new Error(video.error);
  if (video?.kind !== 'video' || !/^\d{10,}$/.test(video.id || '') || !video.urls?.length) throw new Error('TikTok did not provide a complete video source.');
  await saveVerifiedMedia(video, `TikTok/${safeName(video.username)}/videos/${video.id}`, 'tiktok');
  return {ok: true, message: 'TikTok video saved.'};
}

function safeName(value) {
  return String(value || 'instagram').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
}

function fileName(url, index, kind) {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const ext = kind === 'video' ? 'mp4' : /\.(mp4|webm|jpe?g|png|webp)$/i.exec(path)?.[1]?.toLowerCase();
    const stem = path.replace(/\.(mp4|webm|jpe?g|png|webp)$/i, '');
    return `${String(index).padStart(3, '0')}-${stem.slice(0, 70).replace(/[^a-z0-9._-]/gi, '_') || 'media'}.${ext || (url.includes('.mp4') ? 'mp4' : 'jpg')}`;
  } catch {
    return `${String(index).padStart(3, '0')}-media.jpg`;
  }
}
