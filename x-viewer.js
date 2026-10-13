// Serialized into MAIN so the click resolves only the post the user selected.
function resolveXPost(options = {}) {
  const clicks = window.__poststashX?.clicks;
  const post = clicks?.get(options.clickId);
  if (!post) return {error: 'This post media is not available in the current X page session. Reload the post and try again.'};
  clicks.delete(options.clickId);
  return post;
}
