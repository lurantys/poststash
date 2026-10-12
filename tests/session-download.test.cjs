const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const cdn = 'https://scontent.cdninstagram.com/';
const video = {pk: '321234567890', user: {username: 'private_fixture', is_private: true}, video_versions: [{url: `${cdn}current.mp4`, width: 720, height: 1280}], image_versions2: {candidates: [{url: `${cdn}poster.jpg`}]}};

function context() {
  const state = vm.createContext({window: {}, URL, Uint8Array, DataView, Set, Map, Element: class Element {}, innerWidth: 1000, innerHeight: 800});
  for (const file of ['session-media.js', 'viewer.js', 'media-file.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), state);
  return state;
}
function viewer(state, {src = 'blob:https://www.instagram.com/player', poster = '', props, query = ''} = {}) {
  const node = {tagName: 'VIDEO', src, currentSrc: src, poster, parentElement: null, getBoundingClientRect: () => ({left: 300, right: 700, top: 0, bottom: 800, width: 400, height: 800})};
  if (props) node.__reactProps$fixture = props;
  state.location = new URL(`https://www.instagram.com/stories/highlights/9001/${query}`);
  state.document = {querySelector: () => null, querySelectorAll: selector => selector === 'video,img' ? [node] : []};
}
test('private viewer resolves blob playback from page-owned React props without making API requests', async () => {
  const state = context();
  state.window.fetch = () => assert.fail('metadata request must not occur');
  viewer(state, {props: {story: video}});
  const result = await state.resolveViewerMedia({category: 'highlights'});
  assert.equal(result.kind, 'video');
  assert.equal(result.urls[0], video.video_versions[0].url);
  assert.equal(result.username, 'private_fixture');
  assert.equal(result.via, 'page-player');
});
test('streamed GraphQL and anti-XSSI responses retain private media', async () => {
  const state = context();
  state.window.__poststashMedia.parseText(`for (;;);\n${JSON.stringify({data: {media: video}})}\n${JSON.stringify({data: {unrelated: {pk: '999999999999', video_url: `${cdn}other.mp4`}}})}`);
  viewer(state, {query: '?story_media_id=321234567890'});
  const result = await state.resolveViewerMedia({category: 'highlights'});
  assert.equal(result.urls[0], `${cdn}current.mp4`);
  assert.equal(result.via, 'session-response');
});
test('poster matches the active private Highlight when the route has no slide ID', async () => {
  const state = context(); state.window.__poststashMedia.remember({items: [video]});
  viewer(state, {poster: `${cdn}poster.jpg?different=signature`});
  assert.equal((await state.resolveViewerMedia({category: 'highlights'})).urls[0], `${cdn}current.mp4`);
});
test('an unrelated cached Highlight or player media ID is never substituted', async () => {
  const state = context(); state.window.__poststashMedia.remember(video);
  viewer(state, {query: '?story_media_id=777777777777', props: {story: video}});
  assert.match((await state.resolveViewerMedia({category: 'highlights'})).error, /could not be matched/);
});
test('Story frame ignores a stale route ID and resolves the reused player’s current slide', async () => {
  const state = context();
  const next = {...video, pk: '321234567891', video_versions: [{url: `${cdn}next.mp4`}]};
  state.window.__poststashMedia.remember({items: [video, next]});
  viewer(state, {query: `?story_media_id=${video.pk}`, props: {story: next}});
  const result = await state.resolveViewerMedia({category: 'highlights', currentStory: true});
  assert.equal(result.id, next.pk); assert.equal(result.urls[0], `${cdn}next.mp4`);
});
test('click snapshot survives a Story advancing before the background download resolves', async () => {
  const state = context(); viewer(state, {props: {story: video}});
  const clicks = new Map(); state.window.__poststashStoryFrames = {clicks};
  clicks.set('fixture-click', state.resolveViewerMedia({category: 'highlights', currentStory: true}));
  viewer(state, {props: {story: {...video, pk: '321234567891', video_versions: [{url: `${cdn}next.mp4`}]}}});
  const result = await state.resolveViewerMedia({category: 'highlights', storyClickId: 'fixture-click'});
  assert.equal(result.id, video.pk); assert.equal(clicks.size, 0);
});
test('byte-range query parameters are removed without stripping the signed URL', async () => {
  const state = context(); viewer(state, {props: {video_url: `${cdn}current.mp4?token=secret&bytestart=0&byteend=2047`}});
  assert.equal((await state.resolveViewerMedia({category: 'highlights'})).urls[0], `${cdn}current.mp4?token=secret`);
});
test('host validation rejects lookalike domains and supports both Instagram CDN suffixes', () => {
  const state = context(), allowed = state.window.__poststashMedia.allowed;
  assert.equal(allowed('https://scontent.cdninstagram.net/current.mp4'), true);
  assert.equal(allowed('https://notinstagram.com/current.mp4'), false);
  assert.equal(allowed('https://cdninstagram.com.attacker.test/current.mp4'), false);
});
test('nested progressive delivery retains the private media ID and owner', async () => {
  const state = context();
  state.window.__poststashMedia.remember({pk: video.pk, user: video.user, videoDeliveryResponseFragment: {video_delivery_response: {progressive_urls: [{progressive_url: `${cdn}current.mp4`}]}}});
  viewer(state, {query: `?story_media_id=${video.pk}`});
  const result = await state.resolveViewerMedia({category: 'highlights'});
  assert.equal(result.id, video.pk); assert.equal(result.username, 'private_fixture');
});
test('unrecognized collection shapes do not prevent subsequent valid media capture', () => {
  const state = context(); state.window.__poststashMedia.remember({unexpected: {video_versions: {}}, valid: video});
  assert.equal(state.window.__poststashMedia.items.has(video.pk), true);
});
test('carousel capture retains each full slide', () => {
  const state = context(); state.window.__poststashMedia.remember({pk: '456789012345', code: 'FixturePost', carousel_media: [video, {pk: '555555555555', display_url: `${cdn}photo.jpg`}]});
  const post = state.window.__poststashMedia.items.get('456789012345');
  assert.equal(post.kind, 'carousel'); assert.equal(post.slides.length, 2);
});
test('initial page carousel takes priority over its currently rendered single slide', async () => {
  const state = context(); viewer(state, {props: {story: video}});
  const post = {pk: '456789012345', code: 'FixturePost', carousel_media: [video, {pk: '555555555555', display_url: `${cdn}photo.jpg`}]};
  state.location = new URL('https://www.instagram.com/p/FixturePost/');
  const previous = state.document.querySelectorAll;
  state.document.querySelectorAll = selector => selector.includes('application/json') ? [{textContent: JSON.stringify({data: {post}})}] : previous(selector);
  const result = await state.resolveViewerMedia({category: 'posts', group: 'FixturePost'});
  assert.equal(result.assets.length, 2); assert.equal(result.via, 'initial-page-response');
});
function box(type, data = Buffer.alloc(8)) {
  const header = Buffer.alloc(8); header.writeUInt32BE(data.length + 8); header.write(type, 4); return Buffer.concat([header, data]);
}
function arrayBuffer(bytes) { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
test('empty responses, HTML errors, video chunks, and truncated MP4s are rejected', () => {
  const inspect = context().inspectMediaFile;
  for (const bytes of [Buffer.alloc(0), Buffer.from('<html>Login required, no media is available.</html>'), box('moof', Buffer.alloc(64)), Buffer.concat([box('ftyp'), box('moov'), box('mdat')]).subarray(0, 40)]) {
    assert.throws(() => inspect(arrayBuffer(bytes), 'video'));
  }
});
test('complete MP4 containers are accepted and thumbnails cannot become .mp4 files', () => {
  const inspect = context().inspectMediaFile;
  const hdlr = box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from('vide'), Buffer.alloc(12)]));
  assert.equal(inspect(arrayBuffer(Buffer.concat([box('ftyp'), box('moov', box('trak', box('mdia', hdlr))), box('mdat')])), 'video').ext, 'mp4');
  assert.throws(() => inspect(arrayBuffer(Buffer.concat([box('ftyp'), box('moov'), box('mdat')])), 'video'), /fragment/);
  const jpeg = Buffer.alloc(64); jpeg[0] = 255; jpeg[1] = 216; jpeg[62] = 255; jpeg[63] = 217;
  assert.throws(() => inspect(arrayBuffer(jpeg), 'video'), /thumbnail/);
});
