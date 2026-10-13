// Serialized into MAIN so the download uses the exact post captured by the click.
function resolveTikTokVideo(options = {}) {
  const clicks = window.__poststashTikTok?.clicks;
  const snapshot = clicks?.get(options.clickId);
  if (!snapshot) return {error: 'The TikTok click expired. Click the current post’s download button again.'};
  clicks.delete(options.clickId);
  return snapshot;
}
