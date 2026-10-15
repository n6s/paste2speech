import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectMp3} from '../cloudflare/prepared/mp3.js';
import {MsePlayer} from '../public/mse-buffer-player.js';
globalThis.window=new EventTarget();
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaSession:{playbackState:'none',setPositionState(){}}}});
class AudioFixture extends EventTarget {
 paused=false;ended=false;currentTime=3;duration=20;buffered={length:1,start:()=>0,end:()=>20};
 async play(){this.paused=false;this.dispatchEvent(new Event('playing'));}
 pause(){this.paused=true;queueMicrotask(()=>this.dispatchEvent(new Event('pause')));}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){globalThis.window=new EventTarget();const audio=new AudioFixture(),states=[];const player=new MsePlayer(audio,p=>states.push(p.state));Object.assign(player,{job:'saved-job',state:'playing',wantPlay:true,mediaActive:true,status:{state:'ready',starts:[0,10],duration:20},finalized:true,next:2});return {audio,player,states};}
test('native media pause clears playback intent and Media Session; one explicit resume reuses audio and position',async()=>{
 const {audio,player}=fixture();audio.pause();await tick();
 assert.equal(player.state,'paused');assert.equal(player.wantPlay,false);assert.equal(navigator.mediaSession.playbackState,'paused');assert.equal(audio.currentTime,3);
 for(const name of ['canplay','progress','playing','waiting','stalled'])audio.dispatchEvent(new Event(name));
 assert.equal(player.state,'paused');assert.equal(audio.paused,true);assert.equal(player.wantPlay,false);
 player.resume();await tick();assert.equal(player.state,'playing');assert.equal(player.wantPlay,true);assert.equal(audio.paused,false);assert.equal(audio.currentTime,3);assert.equal(player.job,'saved-job');
});
test('native pause while buffering offers resume and invalidates an outstanding play rejection',async()=>{
 const {audio,player}=fixture();audio.dispatchEvent(new Event('waiting'));assert.equal(player.state,'buffering');
 let reject;audio.play=()=>new Promise((_,fail)=>reject=fail);const pending=player.play();audio.pause();await tick();
 assert.equal(player.state,'paused');assert.equal(player.wantPlay,false);
 reject(new DOMException('Audio interrupted','AbortError'));await pending;assert.equal(player.state,'paused');assert.equal(player.wantPlay,false);
});
test('native loading suspension and stale pause events after resume do not stop active playback',()=>{
 const {audio,player}=fixture();audio.dispatchEvent(new Event('suspend'));audio.dispatchEvent(new Event('pause'));
 assert.equal(audio.paused,false);assert.equal(player.state,'playing');assert.equal(player.wantPlay,true);
});
test('source preparation, explicit pause, completion, failure and stopped-player callbacks keep their states',async()=>{
 for(const state of ['preparing','ready','paused','disconnected','failed','idle','done']){
  const {audio,player}=fixture();player.state=state;player.wantPlay=state==='preparing';audio.pause();await tick();assert.equal(player.state,state);
 }
 const {audio,player}=fixture();player.pause();await tick();assert.equal(player.state,'paused');assert.equal(player.wantPlay,false);
 const ended=fixture();ended.audio.ended=true;ended.audio.pause();await tick();ended.audio.dispatchEvent(new Event('ended'));assert.equal(ended.player.state,'done');assert.equal(ended.player.wantPlay,false);
});

for(const queuedPause of [false,true])test(`new audio cannot restart a native interruption ${queuedPause?'before':'after'} the pause event`,async()=>{
 const {audio,player}=fixture();
 const bytes=await readFile(new URL('./fixtures/wavenet/en-US-Wavenet-F-00.mp3',import.meta.url)),info=inspectMp3(bytes),duration=info.samples/24000;
 audio.currentTime=.1;audio.buffered={length:1,start:()=>0,end:()=>duration};
 let plays=0;audio.play=async()=>{plays++;};
 Object.assign(player,{mode:'mse',next:0,finalized:false,controller:new AbortController(),source:{endOfStream(){}},buffer:{appendBuffer(){}}});
 player.request=async(path,options)=>options?.binary?bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength):{state:'ready',starts:[0],duration,total:1,sections:[{start:0,samples:info.samples,bytes:info.bytes}]};
 player.bufferOperation=async operation=>{if(queuedPause)audio.paused=true;else{audio.pause();await tick();}operation();};
 await player.pump();if(queuedPause)audio.dispatchEvent(new Event('pause'));assert.equal(player.next,1);assert.equal(player.finalized,true);assert.equal(plays,0);assert.equal(player.wantPlay,false);assert.equal(player.state,'paused');assert.equal(player.job,'saved-job');
});
