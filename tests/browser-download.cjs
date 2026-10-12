// Real Chromium extension checks with synthetic Instagram/private-session responses.
// Uses a public CC0 video as bytes; never accesses the user's Chrome profile.
const {chromium} = require(process.env.POSTSTASH_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const mediaId = '321234567890';

async function run() {
  const videoResponse = await fetch('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
  assert.equal(videoResponse.ok, true);
  const videoBytes = Buffer.from(await videoResponse.arrayBuffer());
  const nextMarker = Buffer.alloc(12); nextMarker.writeUInt32BE(12); nextMarker.write('freeNEXT', 4);
  const nextVideoBytes = Buffer.concat([videoBytes, nextMarker]);
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1kAAAAASUVORK5CYII=', 'base64');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poststash-extension-test-'));
  let fixtureMode = 'react', fileMode = 'complete', cdnRequests = 0, metadataRequests = 0, sessionCookieSeen = false, delayNext = false;
  const openssl = process.env.POSTSTASH_OPENSSL || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl');
  const keyPath = path.join(temp, 'fixture.key'), certPath = path.join(temp, 'fixture.crt');
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-subj', '/CN=scontent.cdninstagram.com', '-days', '1'], {stdio: 'ignore'});
  const server = https.createServer({key: await fs.readFile(keyPath), cert: await fs.readFile(certPath)}, (request, response) => {
    cdnRequests++;
    if (request.url.startsWith('/current.mp4') && /fixture-session=signed-in/.test(request.headers.cookie || '')) sessionCookieSeen = true;
    const image = request.url.includes('.png');
    const bad = fileMode === 'empty' && !request.url.includes('/player.mp4') && !image;
    const body = image ? imageBytes : bad ? Buffer.alloc(0) : request.url.startsWith('/next.mp4') ? nextVideoBytes : videoBytes;
    const finish = () => {response.writeHead(200, {'Content-Type': image ? 'image/png' : 'video/mp4', 'Content-Length': body.length, 'Access-Control-Allow-Origin': request.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true'}); response.end(body);};
    if (delayNext && request.url.startsWith('/next.mp4')) setTimeout(finish, 750); else finish();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const cdn = `https://scontent.cdninstagram.com:${server.address().port}`;
  const context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: path.join(temp, 'files'),
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--host-resolver-rules=MAP scontent.cdninstagram.com 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server', '--disable-features=LocalNetworkAccessChecks']
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const browserErrors = [];
    page.on('pageerror', error => {browserErrors.push(error.message); console.error('Fixture page error:', error.message);});
    page.on('requestfailed', request => {if (request.failure()?.errorText !== 'net::ERR_ABORTED') console.error('Fixture request failed:', request.failure()?.errorText);});
    const media = {pk: mediaId, user: {username: 'private_fixture', is_private: true}, video_versions: [{url: `${cdn}/current.mp4?token=signed`, width: 720, height: 1280}], image_versions2: {candidates: [{url: `${cdn}/poster.png`}]}};
    await context.route('https://www.instagram.com/**', async route => {
      if (/graphql/.test(route.request().url())) {
        metadataRequests++;
        return route.fulfill({contentType: 'application/json', body: fixtureMode === 'xhr' ? JSON.stringify({data: {media}}) : `for (;;);\n${JSON.stringify({data: {media}})}\n${JSON.stringify({data: {ignored: true}})}`});
      }
      const photo = {pk: '555555555555', user: media.user, image_versions2: {candidates: [{url: `${cdn}/poster.png`, width: 720, height: 1280}]}};
      const post = {pk: '456789012345', code: 'FixturePost', user: media.user, carousel_media: [media, photo]};
      if (fixtureMode === 'photo') return route.fulfill({contentType: 'text/html', body: `<!doctype html><style>body{margin:0}.story-frame{position:relative;width:min(400px,100vw);height:700px;margin:0 auto}img{display:block;width:100%;height:700px}button{position:absolute;left:80%;top:20px}</style><div class="story-frame" id="story-frame"><img src="${cdn}/poster.png"></div><button aria-label="Pause">Pause</button><script>window.fixtureReady=true;</script>`});
      const postMode = fixtureMode === 'carousel';
      const initial = postMode ? `<script type="application/json">${JSON.stringify({data: {post}})}</script>` : '';
      const script = fixtureMode === 'react' || postMode
        ? `v.__reactProps$fixture = {story: ${JSON.stringify(media)}};`
        : fixtureMode === 'xhr' ? `await new Promise(resolve=>{const xhr=new XMLHttpRequest();xhr.open('GET','/graphql/query/');xhr.responseType='json';xhr.onload=resolve;xhr.send();});v.poster='${cdn}/poster.png';`
        : `await fetch('/graphql/query/'); v.poster='${cdn}/poster.png';`;
      return route.fulfill({contentType: 'text/html', body: `<!doctype html><style>body{margin:0;background:#333}.story-frame{position:relative;width:min(400px,100vw);height:700px;margin:0 auto}video{display:block;width:400px;height:700px;margin:0 auto}.story-frame video{width:100%}button{position:absolute;left:80%;top:20px}</style>${initial}${postMode ? '<div role="dialog">' : '<div class="story-frame" id="story-frame">'}<video id="v"></video>${postMode ? '' : '</div>'}<button aria-label="${postMode ? 'Like' : 'Pause'}">Control</button>${postMode ? '</div>' : ''}<script>(async()=>{const bytes=await fetch('${cdn}/player.mp4').then(r=>r.arrayBuffer());const v=document.getElementById('v');v.src=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));${script}window.fixtureReady=true;})()</script>`});
    });
    await context.addCookies([{name: 'fixture-session', value: 'signed-in', domain: 'scontent.cdninstagram.com', path: '/', secure: true, sameSite: 'None'}]);
    async function openViewer(query = '') {
      await page.goto(`https://www.instagram.com/stories/highlights/9001/${query}`);
      await page.waitForFunction(() => window.fixtureReady);
      await page.locator('#poststash-story-download button').waitFor();
    }
    async function allDownloads() { return worker.evaluate(() => chrome.downloads.search({})); }
    async function downloadAndVerify(expected = [videoBytes], control = '#poststash-story-download', afterClick) {
      const previous = new Set((await allDownloads()).map(item => item.id));
      await page.locator(`${control} button`).click();
      if (afterClick) await afterClick();
      let current;
      for (let attempt = 0; attempt < 100; attempt++) {
        current = (await allDownloads()).filter(item => !previous.has(item.id)).sort((a, b) => a.id - b.id);
        if (current.length === expected.length && current.every(item => item.state === 'complete')) break;
        const button = page.locator(`${control} button`);
        if (await button.isEnabled() && /could not|returned|missing|No file|server|source|exposed/i.test(await button.getAttribute('title') || '')) throw new Error(await button.getAttribute('title'));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(current?.length, expected.length, 'Chrome must create exactly the expected files');
      for (let index = 0; index < expected.length; index++) {
        assert.equal(current[index].state, 'complete', 'Chrome must finish saving the file');
        assert.equal(current[index].fileSize, expected[index].length);
        assert.deepEqual(await fs.readFile(current[index].filename), expected[index], 'Saved bytes must equal the complete original file');
      }
      await page.waitForFunction(selector => !document.querySelector(selector).shadowRoot.querySelector('button').disabled, control);
    }
    await openViewer();
    const isolation = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({url: 'https://www.instagram.com/*'});
      const read = () => Object.keys(document.querySelector('video')).some(key => key.startsWith('__reactProps$'));
      const [isolated] = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'ISOLATED', func: read});
      const [main] = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: read});
      return {isolated: isolated.result, main: main.result};
    });
    assert.deepEqual(isolation, {isolated: false, main: true});
    await downloadAndVerify();
    assert.equal(metadataRequests, 0, 'React source download must not request metadata');
    assert.equal(sessionCookieSeen, true, 'The media fetch must include browser session cookies');
    console.log('PASS: private Highlight with blob playback resolves in MAIN and saves a complete original video');

    fixtureMode = 'capture';
    await openViewer(`?story_media_id=${mediaId}`);
    await downloadAndVerify();
    assert.equal(metadataRequests, 1, 'Only the viewer itself should request metadata');
    console.log('PASS: streamed private-session GraphQL response is reused without an extension metadata request');
    await openViewer();
    await downloadAndVerify();
    console.log('PASS: active Highlight video is identified by its poster when no slide ID is in the route');

    fileMode = 'empty';
    const before = (await allDownloads()).length;
    await page.locator('#poststash-story-download button').click();
    await page.waitForFunction(() => {
      const button = document.querySelector('#poststash-story-download').shadowRoot.querySelector('button');
      return !button.disabled && /empty|incomplete/.test(button.title);
    });
    assert.equal((await allDownloads()).length, before, 'No empty file may be created');
    fileMode = 'complete';
    await downloadAndVerify();
    console.log('PASS: empty response saves no file, restores the download button, and permits a successful retry');

    fixtureMode = 'photo';
    await openViewer();
    await downloadAndVerify([imageBytes]);
    console.log('PASS: private Highlight image saves the original image bytes');

    fixtureMode = 'carousel';
    await page.goto('https://www.instagram.com/p/FixturePost/');
    await page.waitForFunction(() => window.fixtureReady);
    await page.locator('#poststash-post-download button').waitFor();
    await downloadAndVerify([videoBytes, imageBytes], '#poststash-post-download');
    console.log('PASS: private carousel saves every video and photo from initial page data');

    fixtureMode = 'react';
    await page.goto(`https://www.instagram.com/stories/private_fixture/${mediaId}/`);
    await page.waitForFunction(() => window.fixtureReady);
    await page.locator('#poststash-story-download button').waitFor();
    await downloadAndVerify();
    console.log('PASS: regular private Story downloads through the same session path');

    fixtureMode = 'xhr';
    await openViewer(`?story_media_id=${mediaId}`);
    await downloadAndVerify();
    console.log('PASS: JSON XMLHttpRequest viewer responses also supply the private Highlight media');

    fixtureMode = 'react';
    await openViewer(`?story_media_id=${mediaId}`);
    const nextMedia = {...media, pk: '321234567891', video_versions: [{url: `${cdn}/next.mp4?token=signed`, width: 720, height: 1280}]};
    await page.evaluate(({media, nextMedia}) => {
      window.__poststashMedia.remember({items: [media, nextMedia]});
      window.previousStoryButton = document.querySelector('#poststash-story-download');
      window.previousStorySource = document.querySelector('#v').currentSrc;
      document.querySelector('#v').__reactProps$fixture = {story: nextMedia};
    }, {media, nextMedia});
    await page.waitForFunction(() => document.querySelector('#poststash-story-download') !== window.previousStoryButton);
    assert.equal(await page.evaluate(() => document.querySelector('#v').currentSrc === window.previousStorySource), true, 'The regression must reuse the same blob player and URL');
    await downloadAndVerify([nextVideoBytes]);
    console.log('PASS: reused player and stale Story URL get a new button that downloads the current slide');

    delayNext = true;
    await downloadAndVerify([nextVideoBytes], '#poststash-story-download', async () => {
      await page.evaluate(media => {
        window.previousStoryButton = document.querySelector('#poststash-story-download');
        document.querySelector('#v').__reactProps$fixture = {story: media};
      }, media);
      await page.waitForFunction(() => document.querySelector('#poststash-story-download') !== window.previousStoryButton);
      assert.equal(await page.locator('#poststash-story-download button').isEnabled(), true, 'The next Story needs its own usable button during a previous download');
    });
    delayNext = false;
    console.log('PASS: advancing during a download preserves the clicked slide and gives the next Story an independent button');

    await page.evaluate(nextMedia => {
      const previous = document.querySelector('#story-frame');
      previous.setAttribute('aria-hidden', 'true');
      const frame = document.createElement('div'); frame.className='story-frame'; frame.id='current-story-frame';
      const video = document.createElement('video'); video.id='next-story-video'; video.src=document.querySelector('#v').src; video.__reactProps$fixture={story:nextMedia};
      frame.append(video); previous.after(frame); previous.style.position='absolute'; previous.style.inset='0'; previous.style.width='800px'; previous.style.visibility='hidden';
    }, nextMedia);
    await page.waitForFunction(() => document.querySelector('#poststash-story-download')?.parentElement.id === 'current-story-frame');
    await downloadAndVerify([nextVideoBytes]);
    console.log('PASS: replacing the Story frame ignores a larger preloaded previous frame');

    async function assertInsideFrame() {
      const bounds = await page.evaluate(() => {
        const host = document.querySelector('#poststash-story-download');
        const button = host.shadowRoot.querySelector('button').getBoundingClientRect();
        const media = document.querySelector('[data-poststash-story-active]').getBoundingClientRect();
        return {inside: button.left >= media.left && button.right <= media.right && button.top >= media.top && button.bottom <= media.bottom, inFrame: host.parentElement.id === 'current-story-frame', width: button.width};
      });
      assert.equal(bounds.inside, true); assert.equal(bounds.inFrame, true); assert.equal(bounds.width, 40);
    }
    await assertInsideFrame();
    await page.screenshot({path: path.join(temp, 'story-frame-desktop.png')});
    await page.setViewportSize({width: 375, height: 812});
    await page.waitForTimeout(200);
    await assertInsideFrame();
    await page.screenshot({path: path.join(temp, 'story-frame-mobile.png')});
    console.log('PASS: button stays inside the actual Story frame at desktop and phone viewport widths');
    console.log(`Visual checks: ${temp}`);
    assert.deepEqual(browserErrors, []);
    console.log(`Browser checks passed (${cdnRequests} fixture media requests).`);
  } finally { await context.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
