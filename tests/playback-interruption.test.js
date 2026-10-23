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

test('browser automatic resume of the interrupted resource reconciles UI and Media Session without another app play call',async()=>{const {audio,player}=fixture();audio.src='blob:saved-reading';audio.pause();await tick();assert.equal(player.wantPlay,false);let appPlays=0;player.play=async()=>{appPlays++;};await audio.play();assert.equal(player.state,'playing');assert.equal(player.wantPlay,true);assert.equal(navigator.mediaSession.playbackState,'playing');assert.equal(player.job,'saved-job');assert.equal(audio.currentTime,3);assert.equal(appPlays,0);assert.equal(player.events.filter(e=>e.type==='playback-resumed-externally').length,1);});
test('explicit user pause retires the native-resume permission and stale notifications cannot resume it',async()=>{const {audio,player}=fixture();audio.pause();await tick();player.pause();await tick();assert.equal(player.mediaPause.kind,'user');for(const name of ['playing','canplay','progress','waiting'])audio.dispatchEvent(new Event(name));assert.equal(player.state,'paused');assert.equal(player.wantPlay,false);assert.equal(audio.paused,true);assert.equal(navigator.mediaSession.playbackState,'paused');audio.paused=false;audio.dispatchEvent(new Event('playing'));assert.equal(player.wantPlay,false);assert.equal(player.state,'paused');assert.equal(audio.paused,true);});
test('native-resume permission cannot cross a new media epoch, job, source, connection pause or failure',async()=>{for(const change of ['serial','job','src','currentSrc','connection','failure','ended']){const {audio,player}=fixture();audio.src='blob:original';audio.currentSrc='blob:original';audio.pause();await tick();if(change==='serial')player.serial++;if(change==='job')player.job='different-job';if(change==='src')audio.src='blob:new-resource';if(change==='currentSrc')audio.currentSrc='blob:other-current-resource';if(change==='connection')player.connectionPaused=true;if(change==='failure')player.fatal=true;if(change==='ended')audio.ended=true;audio.paused=false;audio.dispatchEvent(new Event('playing'));assert.equal(player.wantPlay,false,change);assert.equal(player.state,'paused',change);}});

test('a late rejected app play promise cannot overwrite a genuine native automatic resume',async()=>{const {audio,player}=fixture();let reject;audio.play=()=>new Promise((_,fail)=>reject=fail);const pending=player.play();audio.pause();await tick();audio.paused=false;audio.dispatchEvent(new Event('playing'));assert.equal(player.state,'playing');reject(new DOMException('Old interrupted play','AbortError'));await pending;audio.dispatchEvent(new Event('pause'));assert.equal(player.state,'playing');assert.equal(player.wantPlay,true);assert.equal(navigator.mediaSession.playbackState,'playing');});
test('later recoverable preparation failure drains available audio and pauses at its boundary',async()=>{
 const {audio,player}=fixture();const controller=new AbortController();Object.assign(player,{mode:'mse',finalized:false,controller,serial:10,status:null});
 const status={state:'failed',canResumePreparation:true,error:'The credit reservation could not be checked before the next speech request.',completed:2,total:4,duration:20,starts:[0,10],sections:[{index:0},{index:1}]};
 player.request=async()=>status;player.emit=()=>{if(player.status===status&&player.serial===10){player.serial++;controller.abort();}};
 await player.pump(10);assert.equal(audio.paused,false);assert.equal(player.wantPlay,true);assert.equal(player.fatal,undefined);assert.match(player.error,/Available audio is kept/);
 audio.currentTime=20-1/48000;audio.dispatchEvent(new Event('timeupdate'));assert.equal(audio.paused,true);assert.equal(player.state,'paused');assert.equal(player.wantPlay,false);assert.equal(player.finalized,false,'missing suffix must never look completed');
});
