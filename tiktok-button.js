(() => {
  const hostId = 'poststash-tiktok-download';
  const icon = '<svg width="24" height="24" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true"><path d="M20 4h8v18l7-7 5 5-16 16L8 20l5-5 7 7V4ZM6 34h6v6h24v-6h6v12H6V34Z"/></svg>';
  let control = null, queued = false, toastTimer = 0;
  function notify(message) {
    let toast = document.getElementById('poststash-tiktok-status');
    if (!toast) { toast = document.createElement('div'); toast.id = 'poststash-tiktok-status'; toast.setAttribute('role', 'status'); toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#202020;color:white;border-radius:8px;padding:12px 18px;font:14px/1.4 system-ui;max-width:calc(100vw - 48px);pointer-events:none;'; document.documentElement.append(toast); }
    toast.textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.remove(), 6500);
  }
  function mount() {
    const media = document.querySelector('video[data-poststash-tiktok-active]'), id = media?.getAttribute('data-poststash-tiktok-active');
    let anchor = null, fullscreen = false, row = null;
    for (let root = media?.parentElement, depth = 0; root && root !== document.body && depth < 14; root = root.parentElement, depth++) {
      const browse = browseControl(root);
      if (browse) { anchor = browse.anchor; row = browse.row; fullscreen = true; break; }
      anchor = root.querySelector('[data-e2e="share-icon"],[data-e2e="browse-share"],[role="button"][aria-label^="Share video"]');
      if (anchor) break;
    }
    if (!anchor && id && /\/@[^/]+\/video\/\d+/.test(location.pathname)) {
      const browse = browseControl(document);
      if (browse) { anchor = browse.anchor; row = browse.row; fullscreen = true; }
    }
    if (!anchor || !id) { control?.host.remove(); control = null; return; }
    if (control?.id !== id || control.fullscreen !== fullscreen || !control.host.isConnected) {
      control?.host.remove();
      const host = document.createElement('span'); host.id = hostId; host.dataset.poststashTiktokButton = 'true'; host.dataset.videoId = id;
      host.style.cssText = `display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin:${fullscreen ? '0' : '0 0 8px'};`;
      const nativeCircle = fullscreen ? anchor : anchor.querySelector('[data-testid="tux-web-icon-button-container"]');
      let button;
      if (nativeCircle) {
        const circle = nativeCircle.cloneNode(true);
        for (const count of circle.querySelectorAll('strong,[data-e2e$="-count"]')) count.remove();
        for (const node of [circle, ...circle.querySelectorAll('[id],[data-e2e]')]) { node.removeAttribute('id'); node.removeAttribute('data-e2e'); }
        button = circle.matches('button') ? circle : circle.querySelector('button');
        if (button) {
          const nativeIcon = button.querySelector('svg');
          const glyph = fullscreen ? icon.replace('width="24" height="24"', 'width="20" height="20"') : icon;
          if (nativeIcon) {
            const iconStyle = nativeIcon.style.cssText;
            nativeIcon.outerHTML = glyph;
            button.querySelector('svg').style.cssText = iconStyle;
          }
          else button.innerHTML = icon;
          host.append(circle);
        }
      }
      if (!button) {
        button = document.createElement('button'); button.innerHTML = icon;
        button.style.cssText = 'all:unset;box-sizing:border-box;display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:var(--tux-v2-color-ui-shape-neutral-4,rgba(255,255,255,.12));color:inherit;cursor:pointer;';
        host.append(button);
      }
      button.type = 'button'; button.title = 'Download this TikTok video'; button.setAttribute('aria-label', button.title);
      button.addEventListener('click', async event => {
        event.preventDefault(); event.stopPropagation();
        if (button.disabled) return;
        button.disabled = true; button.setAttribute('aria-busy', 'true'); button.style.opacity = '.55';
        try {
          if (!host.dataset.clickId) throw new Error('The video click could not be captured. Refresh TikTok and try again.');
          const response = await chrome.runtime.sendMessage({type: 'download-tiktok-video', clickId: host.dataset.clickId});
          if (!response?.ok) throw new Error(response?.message || 'Could not download this TikTok video.');
          notify(response.message || 'Video saved.');
        } catch (error) {
          const message = /context invalid/i.test(error.message) ? 'Poststash was reloaded. Refresh this TikTok tab and try again.' : error.message;
          button.title = message; notify(message);
        } finally { button.disabled = false; button.setAttribute('aria-busy', 'false'); button.style.opacity = ''; }
      });
      control = {host, id, fullscreen};
    }
    let sibling = anchor;
    if (fullscreen) while (sibling.parentElement && sibling.parentElement !== row) sibling = sibling.parentElement;
    if (sibling.nextElementSibling !== control.host) sibling.insertAdjacentElement('afterend', control.host);
  }
  function browseControl(scope) {
    const shareGroup = [...scope.querySelectorAll('[data-e2e="browse-share-group"]')].find(group => group.getClientRects().length && !group.closest('[aria-hidden="true"]'));
    const favorite = shareGroup?.parentElement.querySelector('[data-e2e="browse-favorite-icon"]')?.closest('button');
    if (!favorite) return null;
    let row = favorite.parentElement;
    while (row && row.parentElement !== shareGroup.parentElement) row = row.parentElement;
    return row ? {anchor: favorite, row} : null;
  }
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; mount(); }); }
  new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-poststash-tiktok-active']});
  for (const event of ['resize', 'popstate']) window.addEventListener(event, schedule);
  setInterval(schedule, 1000); schedule();
})();
