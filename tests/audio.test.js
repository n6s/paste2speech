import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioPlayer } from '../public/audio-player.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
class Context {
 constructor() { this.currentTime=0; this.destination={}; this.sources=[]; }
 async resume() {}
 async decodeAudioData() { return {duration:10}; }
 createBufferSource() {
  const source={ connect(){}, stop(){this.stopped=true;}, start(when,offset){this.offset=offset;} };
  this.sources.push(source); return source;
 }
}
const ok = async () => ({ok:true,arrayBuffer:async()=>new ArrayBuffer(2)});
const settings = {voice:'af_heart',rate:1};
test('workstation reads chosen chunk, buffers next, completes, and releases buffers', async () => {
 const calls=[]; const p=new AudioPlayer(()=>{}, {Context,fetcher:async(url,options)=>{calls.push(JSON.parse(options.body));return ok();}});
 p.start(['one','two','three'],settings,1); await tick();
 assert.equal(calls[0].text,'two'); assert.equal(calls[1].text,'three');
 p.source.onended(); await tick(); assert.equal(p.index,2);
 p.source.onended(); assert.equal(p.state,'done'); assert.equal(p.pending.size,0);
});
test('pause retains exact audio position; changed voice regenerates current chunk', async () => {
 const p=new AudioPlayer(()=>{}, {Context,fetcher:ok}); p.start(['one'],settings); await tick();
 p.context.currentTime=2.5; p.pause(); p.resume(settings); await tick();
 assert.equal(p.source.offset,2.5);
 p.pause(); p.resume({...settings,voice:'am_michael'}); await tick(); assert.equal(p.source.offset,0); p.stop();
});
test('pause and resume during download does not double-play', async () => {
 let resolve; const p=new AudioPlayer(()=>{}, {Context,fetcher:()=>new Promise(r=>{resolve=r;})});
 p.start(['one'],settings); await tick(); p.pause(); p.resume(settings); await tick();
 resolve(await ok()); await tick(); assert.equal(p.context.sources.length,1); p.stop();
});
test('stop and seek discard stale audio and late end events', async () => {
 let resolve; let count=0;
 const p=new AudioPlayer(()=>{}, {Context,fetcher:()=>++count===1?new Promise(r=>{resolve=r;}):ok()});
 p.start(['old'],settings); await tick(); p.start(['new'],settings); await tick();
 resolve(await ok()); await tick(); assert.equal(p.context.sources.length,1);
 const ended=p.source.onended; p.stop(); ended(); assert.equal(p.state,'idle'); assert.equal(p.pending.size,0);
});
test('failed request retains position for retry', async () => {
 let fail=true;
 const p=new AudioPlayer(()=>{}, {Context,fetcher:async()=>fail?{ok:false,status:500}:ok()});
 p.start(['one','two'],settings,1); await tick(); assert.equal(p.state,'paused'); assert.equal(p.index,1);
 fail=false; p.resume(settings); await tick(); assert.ok(p.source); p.stop();
});
test('temporary busy response retries after a seek without skipping text', async () => {
 let calls=0;
 const p=new AudioPlayer(()=>{}, {Context,fetcher:async()=>++calls===1?{ok:false,status:503}:ok()});
 p.start(['one'],settings);
 await new Promise(resolve=>setTimeout(resolve,750));
 assert.equal(calls,2); assert.ok(p.source); assert.equal(p.index,0); p.stop();
});
