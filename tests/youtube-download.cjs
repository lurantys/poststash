const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

function box(type, ...kids) {
  const body = Buffer.concat(kids);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length); header.write(type, 4);
  return Buffer.concat([header, body]);
}
function full(type, payload) {
  return box(type, Buffer.concat([Buffer.alloc(4), payload]));
}
function m4aBytes() {
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('M4A '), Buffer.alloc(4), Buffer.from('M4A isom')]));
  const hdlr = full('hdlr', Buffer.concat([Buffer.alloc(4), Buffer.from('soun'), Buffer.alloc(13)]));
  const mdia = box('mdia', full('mdhd', Buffer.alloc(20)), hdlr, box('minf'));
  const moov = box('moov', full('mvhd', Buffer.alloc(96)), box('trak', full('tkhd', Buffer.alloc(80)), mdia));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(2 * 1024 * 1024 + 123))]);
}

async function run() {
  const response = await fetch('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
  assert.equal(response.ok, true);
  const videoBytes = Buffer.from(await response.arrayBuffer());
  const audioBytes = m4aBytes();
  const {VideoPlaybackAbrRequest, StreamerContext, FormatInitializationMetadata, MediaHeader, UMPPartId} = await import('googlevideo/protos');
  const {CompositeBuffer, UmpWriter} = await import('googlevideo/ump');
  const {concatenateChunks} = await import('googlevideo/utils');
  const formatId = {itag: 140, lastModified: '123', xtags: ''};
  const umpBuffer = new CompositeBuffer();
  const writer = new UmpWriter(umpBuffer);
  writer.write(UMPPartId.FORMAT_INITIALIZATION_METADATA, FormatInitializationMetadata.encode({formatId, endSegmentNumber: '1', mimeType: 'audio/mp4', durationUnits: '1000', durationTimescale: '1000'}).finish());
  const split = audioBytes.indexOf('mdat') - 4;
  for (const [sequenceNumber, data] of [audioBytes.subarray(0, split), audioBytes.subarray(split)].entries()) {
    writer.write(UMPPartId.MEDIA_HEADER, MediaHeader.encode({headerId: sequenceNumber, itag: 140, formatId, isInitSeg: sequenceNumber === 0, sequenceNumber, durationMs: sequenceNumber === 0 ? '0' : '1000', contentLength: String(data.length)}).finish());
    writer.write(UMPPartId.MEDIA, Buffer.concat([Buffer.from([sequenceNumber]), data]));
    writer.write(UMPPartId.MEDIA_END, new Uint8Array([sequenceNumber]));
  }
  const umpBytes = Buffer.from(concatenateChunks(umpBuffer.chunks));
  const umpTailBuffer = new CompositeBuffer();
  new UmpWriter(umpTailBuffer).write(UMPPartId.MEDIA_END, new Uint8Array([9]));
  const umpTailBytes = Buffer.from(concatenateChunks(umpTailBuffer.chunks));
  const sabrBody = [...VideoPlaybackAbrRequest.encode({...VideoPlaybackAbrRequest.decode(new Uint8Array()), videoPlaybackUstreamerConfig: new Uint8Array([1, 2, 3]), streamerContext: {...StreamerContext.decode(new Uint8Array()), poToken: new Uint8Array([4, 5, 6]), clientInfo: {clientName: 1, clientVersion: 'fixture'}}}).finish()];
  const thumbBytes = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(100, 0x41), Buffer.from([0xff, 0xd9])]);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poststash-youtube-test-'));
  const key = path.join(temp, 'fixture.key'), cert = path.join(temp, 'fixture.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=rr1---sn-test.googlevideo.com', '-days', '1'], {stdio: 'ignore'});
  const audioRanges = [];
  let truncateAudio = false;
  const server = https.createServer({key: await fs.readFile(key), cert: await fs.readFile(cert)}, (request, response) => {
    if (request.url.includes('sabr=1')) { const body = new URL(request.url, 'https://fixture').searchParams.get('rn') === '1' ? umpTailBytes : umpBytes; response.writeHead(200, {'Content-Type': 'application/vnd.yt-ump', 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*'}); response.end(body); return; }
    const host = request.headers.host || '';
    let body = videoBytes, contentType = 'video/mp4';
    if (host.startsWith('i.ytimg.com')) { body = thumbBytes; contentType = 'image/jpeg'; }
    else if (request.url.includes('itag=140')) { body = audioBytes; contentType = 'audio/mp4'; }
    if (contentType === 'audio/mp4') {
      const range = new URL(request.url, 'https://fixture').searchParams.get('range');
      if (!range) { response.writeHead(403); response.end(); return; }
      audioRanges.push(range);
      const [start, end] = range.split('-').map(Number);
      body = body.subarray(start, end + 1);
      if (truncateAudio) body = body.subarray(0, body.length - 1);
    }
    response.writeHead(200, {'Content-Type': contentType, 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*'});
    setTimeout(() => response.end(body), 100);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const streamHost = 'rr1---sn-test.googlevideo.com';
  const stream = (itag, mime) => `https://${streamHost}:${port}/videoplayback?expire=9999999999&ip=127.0.0.1&id=test&itag=${itag}&mime=${encodeURIComponent(mime)}&clen=1000`;
  const watchId = 'AAAAAAAAAAA', shortsId = 'BBBBBBBBBBB';
  const thumbUrl = `https://i.ytimg.com:${port}/vi/${watchId}/maxresdefault.jpg`;
  const playerResponse = id => ({playabilityStatus: {status: 'OK'}, videoDetails: {videoId: id, title: `Fixture ${id}`, author: 'fixture_author', lengthSeconds: '60', thumbnail: {thumbnails: [{url: thumbUrl.replace(watchId, id), width: 320}, {url: thumbUrl.replace(watchId, id), width: 1920}]}}, streamingData: {adaptiveFormats: [{itag: 140, mimeType: 'audio/mp4', bitrate: 128000, contentLength: String(audioBytes.length), url: stream(140, 'audio/mp4')}]}});
  const webPlayerResponse = id => fixtureMode === 'sabr' ? {...playerResponse(id), streamingData: {serverAbrStreamingUrl: stream(140, 'audio/mp4') + '&sabr=1', adaptiveFormats: [{itag: 140, lastModified: '123', mimeType: 'audio/mp4', bitrate: 128000, approxDurationMs: '1000', contentLength: String(audioBytes.length)}, {itag: 136, lastModified: '456', mimeType: 'video/mp4', bitrate: 100000, height: 720, approxDurationMs: '1000'}]}} : ({...playerResponse(id), streamingData: {serverAbrStreamingUrl: 'https://rr1.googlevideo.com/videoplayback?sabr=1', adaptiveFormats: [{itag: 140, mimeType: 'audio/mp4'}]}});
  let fixtureMode = 'watch';
  const playerRequests = [];
  let rejectAudioRequest = false;
  const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: path.join(temp, 'files'),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, `--host-resolver-rules=MAP ${streamHost} 127.0.0.1,MAP i.ytimg.com 127.0.0.1`, '--ignore-certificate-errors', '--no-proxy-server', '--disable-features=LocalNetworkAccessChecks']
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      globalThis.testDownloadRequests = [];
      const download = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = options => { globalThis.testDownloadRequests.push(options); return download(options); };
    });
    await context.route('https://www.youtube.com/**', route => {
      if (route.request().url().includes('/youtubei/')) {
        const body = route.request().postDataJSON();
        playerRequests.push(body);
        return route.fulfill({contentType: 'application/json', body: JSON.stringify(rejectAudioRequest ? {playabilityStatus: {status: 'UNPLAYABLE', reason: 'This video is unavailable.'}} : playerResponse(body.videoId))});
      }
      if (fixtureMode === 'shorts') return route.fulfill({contentType: 'text/html', body: `<!doctype html><style>body{margin:0;background:#111}ytd-reel-video-renderer,video{display:block}video{width:300px;height:500px}</style><script>window.ytInitialPlayerResponse=${JSON.stringify(webPlayerResponse(shortsId))}</script><ytd-reel-video-renderer><video id="reel"></video><div id="actions"><button>Like</button></div></ytd-reel-video-renderer><script>(async()=>{await fetch('${stream(136, 'video/mp4')}');${fixtureMode === 'sabr' ? `await fetch('${stream(140, 'audio/mp4')}&sabr=1', {method:'POST', body: new Uint8Array(${JSON.stringify(sabrBody)})});` : ''}window.fixtureReady=true})()</script>`});
      return route.fulfill({contentType: 'text/html', body: `<!doctype html><style>body{margin:0;background:#111}.ytp-chrome-bottom{position:relative}.ytp-chrome-controls{display:flex}.ytp-right-controls{display:flex;margin-left:auto}.ytp-button{width:36px;height:36px;color:#fff}video{width:640px;height:360px}</style><script>window.ytInitialPlayerResponse=${JSON.stringify(webPlayerResponse(watchId))}</script><div id="movie_player"><video id="player"></video><div class="ytp-chrome-bottom"><div class="ytp-chrome-controls"><div class="ytp-left-controls"></div><div class="ytp-right-controls"><span class="ytp-right-controls-left"></span><span class="ytp-right-controls-right"><button class="ytp-button ytp-subtitles-button">C</button><button class="ytp-button ytp-settings-button">S</button><button class="ytp-button ytp-fullscreen-button">F</button></span></div></div></div></div><ytd-watch-metadata><div id="actions"><div id="top-level-buttons-computed"><button>Share</button></div></div></ytd-watch-metadata><script>(async()=>{await fetch('${stream(136, 'video/mp4')}');${fixtureMode === 'sabr' ? `await fetch('${stream(140, 'audio/mp4')}&sabr=1', {method:'POST', body: new Uint8Array(${JSON.stringify(sabrBody)})});` : ''}window.fixtureReady=true})()</script>`});
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`https://www.youtube.com/watch?v=${watchId}`);
    await page.waitForFunction(() => window.fixtureReady);
    await page.waitForFunction(id => window.__poststashYouTube?.items.get(id)?.tracks.size === 1, watchId);
    const button = page.locator('#poststash-youtube-download button').first();
    await button.waitFor();
    const placement = await page.evaluate(() => {
      const host = document.getElementById('poststash-youtube-download');
      const group = document.querySelector('ytd-watch-metadata #top-level-buttons-computed');
      const names = [...group.children].map(kid => kid.id || kid.className?.toString().slice(0, 40));
      return {id: host.dataset.videoId, inGroup: host.parentElement === group, last: group.lastChild === host, names};
    });
    assert.equal(placement.id, watchId);
    assert.equal(placement.inGroup, true);
    assert.equal(placement.last, true);
    console.log('PASS: audio button sits in the native video action row beside Share', JSON.stringify(placement.names));
    const downloads = () => worker.evaluate(() => chrome.downloads.search({}));
    async function verifyChoice(choice, filename, expected) {
      const previous = new Set((await downloads()).map(item => item.id));
      await button.click();
      assert.equal(await page.locator('#poststash-youtube-menu').count(), 0);
      let saved;
      for (let attempt = 0; attempt < 100; attempt++) {
        saved = (await downloads()).filter(item => !previous.has(item.id));
        if (saved.length && saved.every(item => item.state === 'complete')) break;
        await page.waitForTimeout(100);
      }
      assert.equal(saved.length, 1); assert.equal(saved[0].state, 'complete');
      const requested = await worker.evaluate(() => globalThis.testDownloadRequests.at(-1));
      assert.equal(requested.filename, filename);
      const actual = await fs.readFile(saved[0].filename);
      assert.equal(actual.equals(expected), true, `Saved ${actual.length} bytes; expected ${expected.length} identical bytes.`);
    }
    await verifyChoice('audio', `YouTube/fixture_author/audio/Fixture ${watchId}.m4a`, audioBytes);
    console.log('PASS: one click resolves complete audio from a SABR-only player without playback');
    assert.equal(audioRanges.length, 3);
    assert.deepEqual(audioRanges.slice(0, 2), ['0-1048575', '1048576-2097151']);
    console.log('PASS: range-only CDN responses are assembled into one complete audio file');
    assert.equal(playerRequests[0].context.client.clientName, 'ANDROID_VR');
    assert.equal(playerRequests[0].videoId, watchId);
    await page.setViewportSize({width: 420, height: 850});
    assert.equal(await button.evaluate(node => getComputedStyle(node).position), 'static');
    fixtureMode = 'shorts';
    await page.goto(`https://www.youtube.com/shorts/${shortsId}`);
    await page.waitForFunction(() => window.fixtureReady);
    await button.waitFor();
    const modal = await page.evaluate(() => {
      const host = document.getElementById('poststash-youtube-download');
      const snapshot = window.__poststashYouTube.snapshot(host.dataset.videoId);
      return {id: host.dataset.videoId, inActions: host.parentElement.id === 'actions', assets: snapshot.assets?.length, thumb: Boolean(snapshot.thumb)};
    });
    assert.deepEqual(modal, {id: shortsId, inActions: true, assets: 1, thumb: true});
    console.log('PASS: Shorts audio button sits in the active reel action column');
    await verifyChoice('audio', `YouTube/fixture_author/audio/Fixture ${shortsId}.m4a`, audioBytes);
    assert.equal(playerRequests.at(-1).videoId, shortsId);
    rejectAudioRequest = true;
    await button.click();
    await page.waitForFunction(() => document.getElementById('poststash-youtube-status')?.textContent === 'This video is unavailable.');
    await page.waitForFunction(() => !document.querySelector('#poststash-youtube-download button').disabled);
    const count = (await downloads()).length;
    rejectAudioRequest = false;
    await verifyChoice('audio', `YouTube/fixture_author/audio/Fixture ${shortsId}.m4a`, audioBytes);
    assert.equal((await downloads()).length, count + 1);
    console.log('PASS: unavailable video shows the server error, resets the button, and supports retry');
    truncateAudio = true;
    const beforeTruncation = (await downloads()).length;
    await button.click();
    await page.waitForFunction(() => document.getElementById('poststash-youtube-status')?.textContent.includes('incomplete audio chunk'));
    assert.equal((await downloads()).length, beforeTruncation);
    console.log('PASS: a truncated chunk fails before Chrome saves any file');
    const stale = await page.evaluate(async () => {
      const clickId = 'navigation-check';
      window.__poststashYouTube.clicks.set(clickId, {id: 'AAAAAAAAAAA'});
      return window.__poststashYouTube.snapshot('AAAAAAAAAAA');
    });
    assert.match(stale.error, /video changed/i);
    console.log('PASS: navigation cannot save the previous video');
    truncateAudio = false;
    fixtureMode = 'sabr';
    await page.goto(`https://www.youtube.com/watch?v=${watchId}`);
    await page.waitForFunction(() => window.fixtureReady);
    await button.waitFor();
    await page.waitForFunction(id => Boolean(window.__poststashYouTube.snapshot(id).sabr), watchId, {timeout: 5000});
    const requestsBeforeSabr = playerRequests.length;
    await verifyChoice('audio', `YouTube/fixture_author/audio/Fixture ${watchId}.m4a`, audioBytes);
    assert.equal(playerRequests.length, requestsBeforeSabr);
    console.log('PASS: native SABR request authorization downloads and assembles the complete audio track');
    assert.deepEqual(errors, []);
    console.log(`YouTube browser checks passed. Screenshot: ${temp}`);
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
