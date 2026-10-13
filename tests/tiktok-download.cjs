const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');

async function run() {
  const response = await fetch('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
  assert.equal(response.ok, true);
  const videoBytes = Buffer.from(await response.arrayBuffer());
  const marker = Buffer.alloc(12); marker.writeUInt32BE(12); marker.write('freeNEXT', 4);
  const nextBytes = Buffer.concat([videoBytes, marker]);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poststash-tiktok-test-'));
  const key = path.join(temp, 'fixture.key'), cert = path.join(temp, 'fixture.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=v16-webapp-prime.tiktok.com', '-days', '1'], {stdio: 'ignore'});
  let empty = false, fixtureMode = 'feed';
  const server = https.createServer({key: await fs.readFile(key), cert: await fs.readFile(cert)}, (request, response) => {
    const body = empty ? Buffer.alloc(0) : request.url.startsWith('/next') ? nextBytes : videoBytes;
    response.writeHead(200, {'Content-Type': 'video/mp4', 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*'});
    setTimeout(() => response.end(body), 200);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const cdn = `https://v16-webapp-prime.tiktok.com:${server.address().port}`;
  const first = {id: '7694075503459798324', author: {uniqueId: 'fixture_creator'}, video: {playAddr: `${cdn}/current.mp4`}};
  const next = {id: '7691016655983430919', author: {uniqueId: 'next_creator'}, video: {playAddr: `${cdn}/next.mp4`}};
  const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: path.join(temp, 'files'),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--host-resolver-rules=MAP v16-webapp-prime.tiktok.com 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server', '--disable-features=LocalNetworkAccessChecks']
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      globalThis.testDownloadRequests = [];
      const download = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = options => { globalThis.testDownloadRequests.push(options); return download(options); };
    });
    await context.route('https://www.tiktok.com/**', route => {
      if (route.request().url().includes('/api/')) return route.fulfill({contentType: 'application/json', body: JSON.stringify({itemList: [next]})});
      if (fixtureMode === 'browse') return route.fulfill({contentType: 'text/html', body: `<!doctype html><style>body{margin:0;background:#111;color:white}article{display:flex;margin:20px}video{width:300px;height:500px}.info{width:420px}.toolbar,.actions{display:flex;align-items:center;justify-content:space-between}.favorite{all:unset;display:flex;align-items:center;gap:8px;height:32px;margin-right:16px}.favorite span{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:rgb(36,36,36)}</style><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({itemList: [first]})}</script><article><div><video id="player"></video></div><div class="info"><p>Fullscreen video</p><div class="toolbar"><div class="actions"><div class="favorite-wrap" style="display:flex;flex-direction:column"><button class="favorite"><span data-e2e="browse-favorite-icon"><svg width="20" height="20" style="color:rgb(245,245,245)"></svg></span><strong data-e2e="browse-favorite-count">123</strong></button></div></div><div data-e2e="browse-share-group"><button aria-label="Share">Share</button></div></div></div></article><script>(async()=>{const r=await fetch('${cdn}/player.mp4');document.querySelector('#player').src=URL.createObjectURL(await r.blob());window.fixtureReady=true})()</script>`});
      return route.fulfill({contentType: 'text/html', body: `<!doctype html><style>body{background:#111;color:white;margin:0}article{display:flex;width:380px;margin:20px auto}video{width:300px;height:500px}aside{display:flex;flex-direction:column;padding:12px}#preloaded{position:absolute;left:-2000px}button,[role=button]{width:48px;height:48px}</style><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({itemList: [first]})}</script><article id="current"><div id="xgwrapper-0-${first.id}"><video id="player"></video></div><aside><div role="button" data-e2e="share-icon" aria-label="Share video"><div class="native-circle" data-testid="tux-web-icon-button-container" style="display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:rgb(36,36,36)"><button style="all:unset;display:grid;place-items:center;width:48px;height:48px"><svg width="24" height="24"></svg></button></div></div></aside></article><article id="preloaded"><div id="xgwrapper-0-${next.id}"><video></video></div><aside><div role="button" data-e2e="share-icon">Share</div></aside></article><script>(async()=>{const r=await fetch('${cdn}/player.mp4');document.querySelector('#player').src=URL.createObjectURL(await r.blob());window.fixtureReady=true})()</script>`});
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://www.tiktok.com/');
    await page.waitForFunction(() => window.fixtureReady);
    const button = page.locator('#poststash-tiktok-download button');
    await button.waitFor();
    const placement = await page.evaluate(() => {
      const host = document.getElementById('poststash-tiktok-download'), share = document.querySelector('#current [data-e2e="share-icon"]');
      return {id: host.dataset.videoId, beside: share.nextElementSibling === host, sameParent: host.parentElement === share.parentElement, text: host.textContent.trim(), nativeStyle: getComputedStyle(host.querySelector('.native-circle')).backgroundColor === getComputedStyle(share.querySelector('.native-circle')).backgroundColor};
    });
    assert.deepEqual(placement, {id: first.id, beside: true, sameParent: true, text: '', nativeStyle: true});
    const downloads = () => worker.evaluate(() => chrome.downloads.search({}));
    async function verify(expected, id, previous) {
      let saved;
      for (let attempt = 0; attempt < 100; attempt++) {
        saved = (await downloads()).filter(item => !previous.has(item.id));
        if (saved.length && saved.every(item => item.state === 'complete')) break;
        await page.waitForTimeout(100);
      }
      assert.equal(saved.length, 1); assert.equal(saved[0].state, 'complete');
      const requested = await worker.evaluate(() => globalThis.testDownloadRequests.at(-1));
      assert.match(requested.filename, new RegExp(`^TikTok/.*/videos/${id}\\.mp4$`));
      assert.deepEqual(await fs.readFile(saved[0].filename), expected);
    }
    let previous = new Set((await downloads()).map(item => item.id));
    await button.click(); await verify(videoBytes, first.id, previous);
    console.log('PASS: visible blob player resolves its exact TikTok item and saves complete bytes');
    await page.waitForFunction(() => !document.getElementById('poststash-tiktok-download').querySelector('button').disabled);
    await page.evaluate(async () => { await fetch('/api/recommend/item_list/'); });
    await page.waitForFunction(id => window.__poststashTikTok.items.has(id), next.id);
    previous = new Set((await downloads()).map(item => item.id));
    await button.click();
    await page.evaluate(({next}) => {
      window.previousButton = document.getElementById('poststash-tiktok-download');
      document.querySelector('#player').parentElement.id = `xgwrapper-0-${next.id}`;
    }, {next});
    await page.waitForFunction(id => document.getElementById('poststash-tiktok-download')?.dataset.videoId === id, next.id);
    await verify(videoBytes, first.id, previous);
    assert.equal(await button.isEnabled(), true);
    assert.equal(await page.evaluate(() => document.getElementById('poststash-tiktok-download') !== window.previousButton), true);
    console.log('PASS: advancing a reused player preserves the clicked video and gives the next video its own button');
    previous = new Set((await downloads()).map(item => item.id));
    await button.click(); await verify(nextBytes, next.id, previous);
    console.log('PASS: metadata captured from the feed API resolves the next video without extra metadata requests');
    await page.waitForFunction(() => !document.getElementById('poststash-tiktok-download').querySelector('button').disabled);
    empty = true; const count = (await downloads()).length;
    await button.click();
    await page.waitForFunction(() => /empty|incomplete/.test(document.getElementById('poststash-tiktok-status')?.textContent || ''));
    assert.equal((await downloads()).length, count); assert.equal(await button.isEnabled(), true);
    empty = false;
    console.log('PASS: empty responses save no file and leave the button usable');
    await page.evaluate(() => { document.getElementById('xgwrapper-0-' + document.getElementById('poststash-tiktok-download').dataset.videoId).id='xgwrapper-0-9999999999999999999'; });
    await page.waitForFunction(() => document.getElementById('poststash-tiktok-download')?.dataset.videoId === '9999999999999999999');
    await button.click();
    await page.waitForFunction(() => /not exposed/.test(document.getElementById('poststash-tiktok-status')?.textContent || ''));
    assert.equal((await downloads()).length, count);
    console.log('PASS: an unmatched current video never downloads an unrelated cached or preloaded item');
    fixtureMode = 'browse';
    await page.goto(`https://www.tiktok.com/@fixture_creator/video/${first.id}`);
    await page.waitForFunction(() => window.fixtureReady);
    await button.waitFor();
    const fullscreen = await page.evaluate(() => {
      const host = document.getElementById('poststash-tiktok-download');
      const favorite = document.querySelector('[data-e2e="browse-favorite-icon"]').closest('button');
      const download = host.querySelector('button'), circle = download.querySelector('span'), glyph = download.querySelector('svg');
      return {id: host.dataset.videoId, beside: favorite.parentElement.nextElementSibling === host, color: getComputedStyle(glyph).color, text: host.textContent.trim(), circle: circle.getBoundingClientRect().height, glyph: glyph.getBoundingClientRect().width};
    });
    assert.deepEqual(fullscreen, {id: first.id, beside: true, color: 'rgb(245, 245, 245)', text: '', circle: 32, glyph: 20});
    previous = new Set((await downloads()).map(item => item.id));
    await button.click(); await verify(videoBytes, first.id, previous);
    console.log('PASS: fullscreen viewer uses its native 32px action button and downloads the selected video');
    assert.deepEqual(errors, []);
    await page.screenshot({path: path.join(temp, 'tiktok-button.png')});
    console.log(`TikTok browser checks passed. Screenshot: ${temp}`);
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
