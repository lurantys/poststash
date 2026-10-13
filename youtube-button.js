(() => {
  const hostId = 'poststash-youtube-download';
  const icon = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14"/></svg>';
  function downloadIcon() {
    const native = document.querySelector('download-button-view-model svg, ytd-download-button-renderer svg, yt-download-button-view-model svg');
    const paths = native?.querySelectorAll('path');
    if (!paths?.length) return icon;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', native.getAttribute('viewBox') || '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    for (const source of paths) {
      const path = document.createElementNS(svg.namespaceURI, 'path');
      for (const name of ['d', 'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']) {
        if (source.hasAttribute(name)) path.setAttribute(name, source.getAttribute(name));
      }
      svg.append(path);
    }
    return svg.outerHTML;
  }
  let control = null, queued = false, toastTimer = 0;
  function notify(message) {
    let toast = document.getElementById('poststash-youtube-status');
    if (!toast) { toast = document.createElement('div'); toast.id = 'poststash-youtube-status'; toast.setAttribute('role', 'status'); toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0f0f0f;color:#fff;border-radius:8px;padding:12px 18px;font:14px/1.4 Roboto,Arial,sans-serif;max-width:calc(100vw - 48px);pointer-events:none;'; document.documentElement.append(toast); }
    clearTimeout(toastTimer);
    for (const animation of toast.getAnimations()) animation.cancel();
    toast.textContent = message;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      toast.animate([
        {opacity: 0, transform: 'translate(-50%, 8px)', offset: 0, easing: 'cubic-bezier(0.16, 1, 0.3, 1)'},
        {opacity: 1, transform: 'translate(-50%, 0)', offset: 0.1},
        {opacity: 1, transform: 'translate(-50%, 0)', offset: 0.9, easing: 'ease-in'},
        {opacity: 0, transform: 'translate(-50%, 4px)', offset: 1}
      ], {duration: 2000, fill: 'forwards'});
    }
    toastTimer = setTimeout(() => toast.remove(), 2000);
  }
  async function download(host, button) {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const label = button.querySelector('span');
    const originalLabel = label?.textContent;
    if (label) label.textContent = 'Saving…';
    notify('Preparing audio download…');
    try {
      if (!host.dataset.clickId) throw new Error('The click could not be captured. Try again.');
      const response = await chrome.runtime.sendMessage({type: 'download-youtube-media', clickId: host.dataset.clickId, choice: 'audio'});
      if (!response?.ok) throw new Error(response?.message || 'Could not download this video.');
      notify(response.message || 'Saved.');
    } catch (error) {
      const message = /context invalid/i.test(error.message || '') ? 'Poststash was reloaded. Refresh this YouTube tab and try again.' : (error.message || 'Could not download this video.');
      notify(message);
    } finally { button.disabled = false; button.removeAttribute('aria-busy'); if (label) label.textContent = originalLabel; }
  }
  function mount() {
    const media = document.querySelector('[data-poststash-yt-active]');
    const id = media?.getAttribute('data-poststash-yt-active');
    const shorts = location.pathname.startsWith('/shorts/');
    const reel = media?.closest('ytd-reel-video-renderer');
    const anchor = shorts
      ? reel?.querySelector('#actions')
      : document.querySelector('ytd-watch-metadata #top-level-buttons-computed, #watch8-secondary-actions #top-level-buttons, ytm-slim-video-action-bar-renderer');
    if (!id || !anchor) { control?.host.remove(); control = null; return; }
    if (!document.getElementById('poststash-youtube-style')) {
      const style = document.createElement('style');
      style.id = 'poststash-youtube-style';
      style.textContent = `
        #${hostId} { display:inline-flex; flex:0 0 auto; margin-left:8px; vertical-align:middle; }
        #${hostId} button { appearance:none; border:0; display:inline-flex; align-items:center; justify-content:center; gap:6px; height:36px; padding:0 12px; border-radius:18px; background:var(--yt-spec-badge-chip-background, #eee); color:var(--yt-spec-text-primary, #0f0f0f); font:500 14px/1 Roboto,Arial,sans-serif; white-space:nowrap; cursor:pointer; }
        #${hostId} button:hover { background:var(--yt-spec-button-chip-background-hover, #ddd); }
        #${hostId} button:focus-visible { outline:2px solid var(--yt-spec-call-to-action, #065fd4); outline-offset:3px; }
        #${hostId} button:disabled { opacity:.6; cursor:wait; }
        #${hostId} svg { width:24px; height:24px; flex-shrink:0; }
        #${hostId}[data-shorts] { display:flex; justify-content:center; margin:16px 0 0; }
        #${hostId}[data-shorts] button { flex-direction:column; gap:6px; height:auto; min-height:64px; padding:8px; border-radius:12px; font-size:12px; }
      `;
      document.documentElement.append(style);
    }
    if (control?.id !== id || !control.host.isConnected) {
      control?.host.remove();
      const host = document.createElement('span');
      host.id = hostId;
      host.dataset.poststashYoutubeButton = 'true'; host.dataset.videoId = id;
      if (shorts) host.dataset.shorts = 'true';
      const button = document.createElement('button');
      button.type = 'button'; button.title = 'Download audio with Poststash';
      button.setAttribute('aria-label', button.title);
      button.innerHTML = downloadIcon();
      const label = document.createElement('span');
      label.textContent = shorts ? 'Audio' : 'Save audio';
      button.append(label); host.append(button);
      control = {host, button, label, id};
    }
    if (control.host.parentElement !== anchor) anchor.append(control.host);
  }
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; try { mount(); } catch {} }); }
  // Delegated clicks survive player re-renders that replace the button node.
  // Runs in bubble phase so the MAIN-world capture listener freezes the click first.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const button = target.closest(`#${hostId} button`);
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    const host = document.getElementById(hostId);
    if (host) void download(host, button);
  });
  new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-poststash-yt-active']});
  document.addEventListener('yt-navigate-finish', schedule, true);
  for (const event of ['resize', 'popstate']) window.addEventListener(event, schedule);
  setInterval(schedule, 1500); schedule();
})();
