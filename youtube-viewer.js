// Serialized into MAIN; the click pins the video while resolution reads its latest audio.
async function resolveYouTubeMedia(options = {}) {
  const session = window.__poststashYouTube;
  const clicked = session?.clicks.get(options.clickId);
  if (!clicked) return {error: 'The YouTube click expired. Click the audio download button again.'};
  session.clicks.delete(options.clickId);
  const shot = session.snapshot(clicked.id);
  if (shot.error) return shot;
  if (shot.sabr?.formats?.length) return {...shot, assets: [{kind: 'audio', sabr: shot.sabr, label: 'audio'}]};

  try {
    // The web player uses SABR; the VR client still returns complete audio files.
    const client = {
      clientName: 'ANDROID_VR', clientVersion: '1.65.10',
      deviceMake: 'Oculus', deviceModel: 'Quest 3',
      osName: 'Android', osVersion: '12L', androidSdkVersion: 32,
      userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      hl: 'en', gl: 'US'
    };
    const visitor = window.ytcfg?.get?.('VISITOR_DATA') || window.ytcfg?.get?.('INNERTUBE_CONTEXT')?.client?.visitorData;
    if (visitor) client.visitorData = visitor;
    const endpoint = new URL('/youtubei/v1/player', location.origin);
    endpoint.searchParams.set('prettyPrint', 'false');
    const key = window.ytcfg?.get?.('INNERTUBE_API_KEY');
    if (key) endpoint.searchParams.set('key', key);
    const response = await fetch(endpoint.href, {
      method: 'POST', credentials: 'omit',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({context: {client}, videoId: clicked.id, contentCheckOk: true, racyCheckOk: true}),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`YouTube audio request failed (HTTP ${response.status}). Try again.`);
    const payload = await response.json();
    if (payload.playabilityStatus?.status !== 'OK') {
      throw new Error(payload.playabilityStatus?.reason || 'YouTube could not provide audio for this video.');
    }
    if (payload.videoDetails?.videoId !== clicked.id) throw new Error('YouTube returned a different video. Please try again.');
    if (payload.videoDetails.isLive) throw new Error('Audio downloads are not available for live broadcasts.');
    const formats = (payload.streamingData?.adaptiveFormats || []).filter(format => {
      if (!/^audio\//.test(format.mimeType || '') || !(Number(format.contentLength) > 0)) return false;
      try {
        const url = new URL(format.url);
        return url.protocol === 'https:' && url.hostname.endsWith('.googlevideo.com');
      } catch { return false; }
    }).sort((a, b) => Number(b.itag === 140) - Number(a.itag === 140) || (b.bitrate || 0) - (a.bitrate || 0));
    if (!formats.length) throw new Error('YouTube could not provide a complete audio download for this video.');
    return {
      ...shot, username: payload.videoDetails.author || shot.username,
      title: payload.videoDetails.title || shot.title,
      assets: [{kind: 'audio', urls: formats.map(format => {
        const url = new URL(format.url);
        url.searchParams.set('range', `0-${Number(format.contentLength) - 1}`);
        return url.href;
      }), label: 'audio'}]
    };
  } catch (error) {
    return {error: /timeout|abort/i.test(error.name || '') ? 'YouTube took too long to prepare the audio. Try again.' : error.message};
  }
}

function resolveYouTubeSabr(options = {}) {
  const shot = window.__poststashYouTube?.snapshot(options.videoId);
  if (shot?.error) return shot;
  if (!shot?.sabr?.formats?.length) return {error: 'YouTube could not authorize the audio download. Refresh this video and try again.'};
  return {...shot, assets: [{kind: 'audio', sabr: shot.sabr, label: 'audio'}]};
}
