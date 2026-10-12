(() => {
  if (window.__igSaverCapture) return;
  const state = {records: [], originalFetch: window.fetch.bind(window)};
  window.__igSaverCapture = state;

  const save = async (request, payload, indexed = false) => {
    try {
      if (request.bodyPromise) request.body = await request.bodyPromise;
      const text = JSON.stringify(payload);
      if (!indexed) window.__poststashMedia?.remember(payload);
      if (!/(edge_owner_to_timeline_media|edge_sidecar_to_children|carousel_media|image_versions2|video_versions|video_url|progressive_urls|display_url|reel_media|highlights|profile_pic_url|edge_followed_by|follower_count|full_name)/i.test(text)) return;
      state.records.push({request, payload});
      if (state.records.length > 250) state.records.splice(0, state.records.length - 250);
    } catch {}
  };

  window.fetch = function(input, init) {
    const request = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method || (input instanceof Request ? input.method : 'GET'),
      body: typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : null,
      headers: {}
    };
    if (!request.body && input instanceof Request && !init?.body)
      request.bodyPromise = input.clone().text().catch(() => null);
    try {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      for (const [key, value] of headers.entries()) request.headers[key] = value;
    } catch {}
    const promise = state.originalFetch(input, init);
    promise.then(response => {
      if (!/graphql|api\/v1/i.test(request.url)) return;
      response.clone().text().then(text => {
        for (const payload of window.__poststashMedia?.parseText(text) || []) save(request, payload, true);
      }).catch(() => {});
    }).catch(() => {});
    return promise;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__igSaverRequest = {url: new URL(url, location.href).href, method, body: null, headers: {}};
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this.__igSaverRequest) this.__igSaverRequest.headers[name.toLowerCase()] = value;
    return setHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this.__igSaverRequest) this.__igSaverRequest.body = typeof body === 'string' ? body : null;
    this.addEventListener('load', () => {
      if (!/graphql|api\/v1/i.test(this.__igSaverRequest?.url || '')) return;
      try {
        if (this.responseType === 'json') save(this.__igSaverRequest, this.response);
        else for (const payload of window.__poststashMedia?.parseText(this.responseText) || []) save(this.__igSaverRequest, payload, true);
      } catch {}
    }, {once: true});
    return send.call(this, body);
  };
})();
