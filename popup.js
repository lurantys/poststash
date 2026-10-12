const downloadButton = document.getElementById('profile');

function setButton(text, state = '') {
  downloadButton.textContent = text;
  downloadButton.classList.toggle('is-loading', state === 'loading');
  downloadButton.classList.toggle('is-error', state === 'error');
  downloadButton.classList.toggle('is-success', state === 'success');
  downloadButton.disabled = state === 'loading';
  downloadButton.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  downloadButton.title = text;
}

async function loadProfileSummary() {
  const empty = document.getElementById('profile-empty');
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.url?.startsWith('https://www.instagram.com/')) return;
    const [{result}] = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      world: 'MAIN',
      func: inspectProfile
    });
    const root = document.documentElement;
    if (result?.theme === 'dark' || result?.theme === 'light') root.dataset.theme = result.theme;
    else delete root.dataset.theme;
    if (!result?.username) return;

    const profile = document.getElementById('account');
    const name = result.fullName || result.username;
    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-handle').textContent = `@${result.username}`;
    const fallback = document.getElementById('avatar-fallback');
    fallback.textContent = (name.trim()[0] || result.username[0] || 'I').toUpperCase();

    const avatar = document.getElementById('profile-avatar');
    if (result.avatar) {
      avatar.alt = `Profile photo for @${result.username}`;
      avatar.onload = () => { avatar.hidden = false; fallback.hidden = true; };
      avatar.onerror = () => { avatar.hidden = true; fallback.hidden = false; };
      avatar.src = result.avatar;
    }

    const bio = document.getElementById('profile-bio');
    if (result.biography) {
      bio.textContent = result.biography;
      bio.hidden = false;
    }

    const stats = document.getElementById('profile-stats');
    const metrics = [
      ['Posts', result.posts],
      ['Followers', result.followers],
      ['Following', result.following]
    ].filter(([, value]) => Number.isFinite(value));
    if (metrics.length) {
      const formatter = new Intl.NumberFormat(undefined, {notation: 'compact', maximumFractionDigits: 1});
      stats.replaceChildren(...metrics.map(([label, value]) => {
        const item = document.createElement('div');
        const term = document.createElement('dt');
        const number = document.createElement('dd');
        term.textContent = label;
        number.textContent = formatter.format(value);
        number.title = value.toLocaleString();
        item.append(term, number);
        return item;
      }));
      stats.hidden = false;
    }

    profile.hidden = false;
    empty.textContent = result.hasDetails
      ? (result.avatar ? '' : 'Instagram has not provided a profile photo yet.')
      : 'Refresh the profile to load its photo and account details.';
    empty.hidden = Boolean(result.hasDetails && result.avatar);
  } catch {
    empty.textContent = 'Refresh the profile to load its photo and account details.';
  }
}

function inspectProfile() {
  const detectTheme = () => {
    const luminance = color => {
      const match = color.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const values = match[1].split(',').map(value => Number.parseFloat(value.trim()));
      if (values.length === 4 && values[3] === 0) return null;
      if (values.length === 4 && values[3] < 0.5) return null;
      const [r, g, b] = values.map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const candidates = [document.querySelector('main'), document.querySelector('header'), document.body, document.documentElement].filter(Boolean);
    for (const element of candidates) {
      const value = luminance(getComputedStyle(element).backgroundColor);
      if (value !== null) return value < 0.35 ? 'dark' : 'light';
    }
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    return scheme.includes('dark') ? 'dark' : scheme.includes('light') ? 'light' : null;
  };
  const theme = detectTheme();
  const parts = location.pathname.split('/').filter(Boolean);
  const reserved = new Set(['about', 'accounts', 'developer', 'direct', 'emails', 'explore', 'legal', 'p', 'privacy', 'reel', 'reels', 'stories', 'tv', 'web']);
  if (parts.length !== 1 || reserved.has(parts[0].toLowerCase())) return {theme};
  const username = parts[0];
  const target = username.toLowerCase();
  const profile = {username, fullName: null, avatar: null, biography: null, posts: null, followers: null, following: null};
  profile.theme = theme;
  const state = window.__igSaverCapture;
  const read = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) { node.forEach(value => read(value, depth + 1)); return; }
    if (typeof node.username === 'string' && node.username.toLowerCase() === target) {
      profile.fullName ||= node.full_name || null;
      profile.avatar ||= node.profile_pic_url_hd || node.profile_pic_url || node.profile_picture_url || node.hd_profile_pic_url_info?.url || node.profile_pic_url_info?.url || null;
      profile.biography ||= node.biography || null;
      profile.posts ??= node.edge_owner_to_timeline_media?.count ?? node.media_count ?? null;
      profile.followers ??= node.edge_followed_by?.count ?? node.follower_count ?? null;
      profile.following ??= node.edge_follow?.count ?? node.following_count ?? null;
    }
    Object.values(node).forEach(value => read(value, depth + 1));
  };
  for (const record of state?.records || []) read(record.payload);
  if (profile.avatar) {
    try {
      const host = new URL(profile.avatar).hostname;
      if (!host.endsWith('cdninstagram.com') && !host.endsWith('fbcdn.net')) profile.avatar = null;
    } catch { profile.avatar = null; }
  }
  profile.hasDetails = Boolean(profile.avatar || profile.fullName || profile.biography || profile.posts !== null || profile.followers !== null || profile.following !== null);
  return profile;
}

async function run() {
  setButton('Starting download...', 'loading');
  try {
    const categories = [...document.querySelectorAll('input[name="category"]:checked')].map(input => input.value);
    if (!categories.length) throw new Error('Choose at least one content type.');
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.url?.startsWith('https://www.instagram.com/')) throw new Error('Open an Instagram profile.');
    const result = await chrome.runtime.sendMessage({
      type: 'download-profile', tabId: tab.id,
      limit: Number(document.getElementById('limit').value) || 0,
      mediaType: document.getElementById('media-type').value,
      categories,
      dateFrom: document.getElementById('date-from').value,
      dateTo: document.getElementById('date-to').value
    });
    if (!result?.ok) throw new Error(result?.message || 'Could not download this profile.');
    setButton('Scanning profile - page 0', 'loading');
    pollProgress(tab.id);
  } catch (error) {
    setButton(error.message || 'Could not download this profile.', 'error');
  }
}

let polling = false;
async function pollProgress(tabId) {
  if (polling) return;
  polling = true;
  try {
    while (true) {
      const response = await chrome.runtime.sendMessage({type: 'get-download-progress', tabId});
      const job = response?.progress;
      if (!job) break;
      if (job.stage === 'scanning') {
        setButton(`Scanning - page ${job.pages} - ${job.items || 0} media found`, 'loading');
      } else if (job.stage === 'waiting') {
        setButton('Waiting for profile media...', 'loading');
      } else if (job.stage === 'downloading') {
        setButton(`Downloading - ${job.downloaded}/${job.total}`, 'loading');
      } else if (job.stage === 'complete') {
        setButton(job.failed ? `Done - ${job.failed} failed to start` : `Done - ${job.downloaded} downloads started`, job.failed ? 'error' : 'success');
        downloadButton.title = job.message || downloadButton.textContent;
        break;
      } else if (job.stage === 'error') {
        setButton(job.error || 'Download failed.', 'error');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch {
    setButton('Progress unavailable - check Chrome downloads', 'error');
  } finally { polling = false; }
}

document.getElementById('profile').addEventListener('click', () => run());
loadProfileSummary();
