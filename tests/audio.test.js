import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioPlayer, assembleWav, parseWav} from '../public/audio-player.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
class Audio extends EventTarget {
  currentTime = 0; paused = true;
  async play() { if (this.blocked) throw new Error('gesture'); this.paused = false; this.dispatchEvent(new Event('play')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  removeAttribute() {} load() {}
}
const settings = {voice: 'af_heart', rate: 1};
const wav = async () => assembleWav([new Uint8Array(48000)], 48000).arrayBuffer();
const ok = async () => ({ok: true, arrayBuffer: wav});
function player(fetcher = ok, extras = {}) {
 const revoked = [], blobs = [];
 const p = new AudioPlayer(() => {}, {audio: new Audio(), fetcher, urls: {createObjectURL: blob => {blobs.push(blob); return `blob:${blobs.length}`;}, revokeObjectURL: url => revoked.push(url)}, ...extras});
 return Object.assign(p, {revoked, blobs});
}
test('WAV assembly produces one header and exact PCM timestamps', async () => {
 const p = player(); p.start(['a', 'b', 'c'], settings, 1); await tick();
 assert.deepEqual(p.starts, [0, 1, 2]); assert.equal(p.audio.currentTime, 1); assert.equal(p.state, 'playing');
 assert.equal(parseWav(await p.blobs[0].arrayBuffer()).pcm.length, 144000); assert.equal(p.parts.length, 0);
 p.audio.currentTime = 2.2; p.sync(); assert.equal(p.index, 2);
 p.audio.dispatchEvent(new Event('ended')); assert.equal(p.state, 'done');
});
test('rejects malformed and unsupported WAV audio', async () => {
 assert.throws(() => parseWav(new ArrayBuffer(12)));
 const bytes = await wav(); new DataView(bytes).setUint32(24, 16000, true);
 assert.throws(() => parseWav(bytes), /format/);
 const truncated = (await wav()).slice(0, 45); assert.throws(() => parseWav(truncated), /Incomplete/);
});
test('pause is exact; paragraph navigation and replay reuse complete audio', async () => {
 let calls = 0; const p = player(async () => {calls++; return ok();});
 p.start(['a', 'b'], settings); await tick(); p.audio.currentTime = .5; p.pause(); p.resume(settings); await tick();
 assert.equal(p.audio.currentTime, .5); p.start(['a', 'b'], settings, 1); await tick();
 assert.equal(p.audio.currentTime, 1); p.stop(); p.start(['a', 'b'], settings); await tick(); assert.equal(calls, 2);
});
test('failed preparation retries only the failed chunk', async () => {
 const calls = []; let fail = true;
 const p = player(async (_, options) => {const {text} = JSON.parse(options.body); calls.push(text); return text === 'b' && fail ? {ok:false} : ok();});
 p.start(['a', 'b'], settings); await tick(); assert.equal(p.state, 'failed'); assert.equal(p.parts.length, 1);
 fail = false; p.resume(settings); await tick(); assert.deepEqual(calls, ['a', 'b', 'b']); assert.equal(p.state, 'playing');
});
test('stop and replacement ignore late requests', async () => {
 let resolve; let calls = 0;
 const p = player(() => ++calls === 1 ? new Promise(r => resolve = r) : ok());
 p.start(['old'], settings); p.stop(); p.start(['new'], settings); await tick(); resolve(await ok()); await tick();
 assert.equal(p.blobs.length, 1); assert.deepEqual(p.chunks, ['new']);
});
test('settings changes regenerate and invalidate old URLs; clear releases content', async () => {
 const p = player(); p.start(['a', 'b'], settings); await tick(); p.audio.currentTime = 1.2; p.pause();
 p.resume({...settings, rate: 1.5}); await tick(); assert.equal(p.audio.currentTime, 1); assert.equal(p.revoked.length, 1);
 p.invalidate(); assert.equal(p.revoked.length, 2); assert.deepEqual(p.chunks, []); assert.equal(p.bytes, 0);
});
test('size limit stops preparation without silently skipping text', async () => {
 const p = player(ok, {maxBytes: 48000}); p.start(['a', 'b'], settings); await tick();
 assert.equal(p.state, 'failed'); assert.equal(p.parts.length, 1); assert.equal(p.blobs.length, 0);
});
test('autoplay rejection leaves a ready track for a fresh gesture', async () => {
 const p = player(); p.audio.blocked = true; p.start(['a'], settings); await tick(); assert.equal(p.state, 'ready');
 p.audio.blocked = false; p.resume(settings); await tick(); assert.equal(p.state, 'playing');
});
test('media controls clamp seeks and release handlers', async () => {
 const handlers = {}, media = {setActionHandler: (name, handler) => handlers[name] = handler, setPositionState: value => media.position = value};
 const p = player(ok, {media}); p.start(['a', 'b'], settings); await tick();
 handlers.pause(); assert.equal(p.state, 'paused'); handlers.play(); await tick(); assert.equal(p.state, 'playing');
 handlers.seekforward(); assert.equal(p.audio.currentTime, 2); handlers.seekbackward(); assert.equal(p.audio.currentTime, 0);
 assert.equal(media.position.duration, 2); handlers.stop(); assert.equal(p.state, 'idle'); p.release(); assert.equal(handlers.play, null);
});
test('unsupported media actions do not prevent playback', async () => {
 const p = player(ok, {media: {setActionHandler() {throw new Error('unsupported');}, setPositionState() {throw new Error('unsupported');}}});
 p.start(['a'], settings); await tick(); assert.equal(p.state, 'playing');
});
test('pausing preparation resumes without overlapping or accepting a stale request', async () => {
 let resolve; let calls = 0;
 const p = player(() => ++calls === 2 ? new Promise(r => resolve = r) : ok());
 p.start(['a', 'b'], settings); await tick(); p.pause(); assert.equal(p.state, 'paused');
 p.resume(settings); await tick(); resolve(await ok()); await tick();
 assert.equal(p.blobs.length, 1); assert.equal(p.duration, 2); assert.equal(calls, 3);
});
test('temporary busy service retries without skipping chunks', async () => {
 let calls = 0; const p = player(async () => ++calls === 1 ? {status: 503} : ok());
 p.start(['a'], settings); await new Promise(resolve => setTimeout(resolve, 750));
 assert.equal(p.state, 'playing'); assert.equal(calls, 2);
});
