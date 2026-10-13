(() => {
  const iconPath = 'M12 16l-5.7-5.7 1.4-1.4 3.3 3.3V2.6h2v9.6l3.3-3.3 1.4 1.4L12 16zM21 15v3.5c0 1.4-1.1 2.5-2.5 2.5h-13C4.1 21 3 19.9 3 18.5V15h2v3.5c0 .3.2.5.5.5h13c.3 0 .5-.2.5-.5V15h2z';
  const icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="width:20px;height:20px;flex:0 0 20px" aria-hidden="true"><path d="${iconPath}"/></svg>`;
  const viewerIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="width:22px;height:22px;flex:0 0 22px" aria-hidden="true"><path d="${iconPath}"/></svg>`;
  const spinner = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" stroke-dasharray="38 18" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/></circle></svg>';
  const downloadedIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/></svg>';
  const storageKey = 'poststashDownloadedXPosts';
  const downloadedPosts = new Set();
  chrome.storage.local.get(storageKey).then(result => {
    for (const id of result[storageKey] || []) downloadedPosts.add(String(id));
    schedule();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[storageKey]) return;
    downloadedPosts.clear();
    for (const id of changes[storageKey].newValue || []) downloadedPosts.add(String(id));
    schedule();
  });
  let toastTimer = 0, queued = false;
  function notify(message) {
    let toast = document.getElementById('poststash-x-status');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'poststash-x-status'; toast.setAttribute('role', 'status');
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#202020;color:white;border-radius:8px;padding:12px 18px;font:14px/1.4 system-ui;max-width:calc(100vw - 48px);pointer-events:none;';
      document.documentElement.append(toast);
    }
    toast.textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.remove(), 6500);
  }
  function statusId(article) {
    for (const anchor of article.querySelectorAll('a[href*="/status/"]')) {
      if (anchor.closest('article[data-testid="tweet"]') !== article) continue;
      const match = anchor.getAttribute('href')?.match(/\/([^/]+)\/status\/(\d+)/);
      if (match) return {id: match[2], username: match[1]};
    }
    return null;
  }
  function hasMedia(article) {
    if (article.querySelector('video,[data-testid="videoPlayer"],[data-testid="tweetPhoto"]')) return true;
    return [...article.querySelectorAll('img[src*="pbs.twimg.com/media"]')].some(image => !image.closest('[data-testid="UserAvatar-Container-"]'));
  }
  function setDownloaded(button, downloaded) {
    button.dataset.downloaded = downloaded ? 'true' : 'false';
    renderIcon(button, downloaded ? downloadedIcon : button.dataset.viewerButton === 'true' ? viewerIcon : icon);
    const label = downloaded ? 'Downloaded — click to save again' : 'Download media from this X post';
    button.title = label; button.setAttribute('aria-label', label);
    button.style.color = button.matches(':hover') ? '#ffd400' : button.dataset.viewerButton === 'true' ? '#fff' : downloaded ? '#00ba7c' : '#71767b';
  }
  function renderIcon(button, markup) {
    const current = button.querySelector('svg');
    if (current) current.outerHTML = markup;
    else button.innerHTML = markup;
  }
  async function rememberDownloaded(id) {
    const result = await chrome.storage.local.get(storageKey);
    const ids = new Set((result[storageKey] || []).map(String));
    ids.add(String(id));
    await chrome.storage.local.set({[storageKey]: [...ids].slice(-2000)});
  }
  function shareForRow(row) {
    return [...row.querySelectorAll('[data-testid="share"],[role="button"],button')].find(node =>
      !node.hasAttribute('data-poststash-x-button') && node.closest('[role="group"]') === row &&
      (node.getAttribute('data-testid') === 'share' || /^share/i.test(node.getAttribute('aria-label') || node.title || ''))
    );
  }
  function cloneAction(row) {
    const source = shareForRow(row);
    if (!source) return null;
    const control = document.createElement('button');
    control.type = 'button';
    control.style.cssText = 'all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;align-self:center;flex:0 0 36px;width:36px;height:36px;margin-left:8px;border-radius:50%;background:transparent;cursor:pointer;';
    control.dataset.poststashXButton = 'true';
    return {source, control};
  }
  function statusFromContext(row) {
    const article = row.closest('article[data-testid="tweet"]');
    if (article) return {status: statusId(article), container: article, viewer: Boolean(row.closest('[role="dialog"],[data-testid*="mediaViewer" i],[data-testid*="photoViewer" i],[data-testid*="swipe-to-dismiss"]') || /\/status\/\d+\/(?:photo|video)\/\d+/.test(location.pathname))};
    for (let root = row.parentElement, depth = 0; root && depth < 12; root = root.parentElement, depth++) {
      if (!root.querySelector('video,[data-testid="tweetPhoto"],img[src*="pbs.twimg.com/media"]')) continue;
      for (const anchor of root.querySelectorAll('a[href*="/status/"]')) {
        const match = anchor.getAttribute('href')?.match(/\/([^/]+)\/status\/(\d+)/);
        if (match) return {status: {id: match[2], username: match[1]}, container: root, viewer: true};
      }
    }
    return null;
  }
  function mountRow(row, status, viewer = false) {
    const controls = [...row.querySelectorAll('[data-poststash-x-button]')].filter(button => button.closest('[role="group"]') === row);
    const existing = controls[0];
    for (const duplicate of controls.slice(1)) duplicate.remove();
    if (existing) {
      existing.dataset.postId = status.id;
      existing.dataset.postUsername = status.username;
      const viewerChanged = existing.dataset.viewerButton !== (viewer ? 'true' : 'false');
      existing.dataset.viewerButton = viewer ? 'true' : 'false';
      if (!existing.matches(':hover') && existing.dataset.loading !== 'true') existing.style.color = viewer ? '#fff' : existing.dataset.downloaded === 'true' ? '#00ba7c' : '#71767b';
      if (existing.dataset.loading !== 'true' && (viewerChanged || (existing.dataset.downloaded === 'true') !== downloadedPosts.has(status.id))) setDownloaded(existing, downloadedPosts.has(status.id));
      return;
    }
    const action = cloneAction(row);
    const button = action?.control || document.createElement('button');
    if (!action) {
      button.type = 'button';
      button.style.cssText = 'all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;cursor:pointer;';
    }
    button.dataset.poststashXButton = 'true'; button.dataset.postId = status.id; button.dataset.postUsername = status.username;
    button.dataset.viewerButton = viewer ? 'true' : 'false';
    button.title = 'Download media from this X post'; button.setAttribute('aria-label', button.title);
    button.style.color = '#71767b'; button.style.cursor = 'pointer';
    setDownloaded(button, downloadedPosts.has(status.id));
    button.addEventListener('mouseenter', () => { button.style.color = '#ffd400'; button.style.background = 'rgba(255,212,0,.12)'; });
    button.addEventListener('mouseleave', () => { button.style.color = button.dataset.viewerButton === 'true' ? '#fff' : button.dataset.downloaded === 'true' ? '#00ba7c' : '#71767b'; button.style.background = ''; });
    button.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      if (button.dataset.loading === 'true') return;
      button.dataset.loading = 'true'; button.setAttribute('aria-disabled', 'true'); button.setAttribute('aria-busy', 'true'); button.title = 'Saving media…'; renderIcon(button, spinner); button.style.opacity = '.8';
      try {
        if (!button.dataset.clickId) throw new Error('Could not capture this post. Refresh X and try again.');
        const response = await chrome.runtime.sendMessage({type: 'download-x-post', clickId: button.dataset.clickId});
        if (!response?.ok) throw new Error(response?.message || 'Could not download this X post.');
        downloadedPosts.add(button.dataset.postId);
        setDownloaded(button, true);
        rememberDownloaded(button.dataset.postId).catch(() => {});
        notify(response.message || 'X post media saved.');
      } catch (error) {
        const message = /context invalid/i.test(error.message) ? 'Poststash was reloaded. Refresh this X tab and try again.' : error.message;
        button.title = message; notify(message);
      } finally { delete button.dataset.loading; button.removeAttribute('aria-disabled'); button.removeAttribute('aria-busy'); if (button.dataset.downloaded !== 'true') setDownloaded(button, false); button.style.opacity = ''; }
    });
    if (action) action.source.insertAdjacentElement('afterend', button);
    else row.append(button);
  }
  function scan() {
    queued = false;
    for (const row of document.querySelectorAll('[role="group"]')) {
      if (!shareForRow(row)) continue;
      const context = statusFromContext(row);
      if (!context?.status || !hasMedia(context.container)) continue;
      mountRow(row, context.status, context.viewer);
    }
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(scan); } }
  new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true});
  window.addEventListener('popstate', schedule);
  setInterval(schedule, 1500); schedule();
})();
