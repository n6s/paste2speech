import test from 'node:test';
import assert from 'node:assert/strict';
import {ProgressivePlayer} from '../public/progressive-player.js';
const tick=()=>new Promise(r=>setImmediate(r));
class Audio extends EventTarget {
 currentTime=0;paused=true;ended=false;playbackRate=1;buffered={length:1,start:()=>0,end:()=>100};
 async play(){if(this.blocked)throw Error('gesture');this.paused=false;this.dispatchEvent(new Event('playing'));}
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
 removeAttribute(){}load(){}
}
const settings={voice:'af_heart',rate:1,paragraphStarts:[0]};
function setup(){
 const calls=[],handlers={},audio=new Audio();
 let snapshot={state:'generating',starts:[.046],duration:2.046,completed:1,total:3};
 const fetcher=async(url,options={})=>{calls.push([url.pathname,options]);return {ok:true,json:async()=>options.method==='POST'?{id:'job'}:snapshot};};
 const media={setActionHandler:(name,handler)=>handlers[name]=handler,setPositionState:value=>media.position=value};
 const player=new ProgressivePlayer(()=>{},{audio,fetcher,media,pollMs:100000});
 return {p:player,audio,calls,handlers,media,setSnapshot:value=>snapshot=value};
}
test('first section plays while generation continues; rate and highlight use original timeline',async()=>{
 const {p,audio,calls,media,setSnapshot}=setup();
 await p.start(['one','two','three'],settings);await tick();
 assert.equal(p.state,'playing');assert.equal(p.complete,false);assert.equal(p.index,0);
 p.setRate(1.5);assert.equal(audio.playbackRate,1.5);assert.equal(media.position.playbackRate,1.5);
 setSnapshot({state:'ready',starts:[.046,2.046,4.046],duration:6.1});await p.refresh();
 audio.currentTime=2.046-0.000001;p.sync();assert.equal(p.index,1);
 audio.currentTime=3;p.sync();assert.equal(p.index,1);
 assert.equal(calls.filter(([,o])=>o.method==='POST').length,1);
 assert.ok(p.download('mp3').endsWith('/job/download/mp3'));await p.invalidate();
});
test('pause keeps generation alive; section navigation preserves paused state',async()=>{
 const {p,audio,handlers,setSnapshot,calls}=setup();await p.start(['one','two','three'],settings);await tick();
 p.pause();assert.equal(p.state,'paused');
 setSnapshot({state:'ready',starts:[.046,2.046,4.046],duration:6.1});await p.refresh();
 handlers.nexttrack();assert.equal(p.index,1);assert.equal(audio.currentTime,2.046);assert.equal(p.state,'paused');
 p.resume({...settings,rate:2});await tick();assert.equal(p.state,'playing');assert.equal(audio.playbackRate,2);
 handlers.previoustrack();await tick();assert.equal(p.index,0);assert.equal(p.state,'playing');
 assert.equal(calls.filter(([,o])=>o.method==='POST').length,1);await p.invalidate();
});
test('navigation waits for ungenerated section without losing highlighting',async()=>{
 const {p,setSnapshot}=setup();await p.start(['one','two','three'],settings);await tick();p.move(1);
 assert.equal(p.state,'preparing');assert.equal(p.index,1);assert.equal(p.audio.paused,true);
 setSnapshot({state:'generating',starts:[.046,2.046],duration:4.046});await p.refresh();await tick();
 assert.equal(p.index,1);assert.equal(p.state,'playing');await p.invalidate();
});
test('autoplay rejection can resume without regenerating; stop reuses completed file',async()=>{
 const {p,audio,setSnapshot,calls}=setup();audio.blocked=true;
 await p.start(['one'],settings);await tick();assert.equal(p.state,'ready');
 setSnapshot({state:'ready',starts:[.046],duration:2.1});await p.refresh();
 audio.blocked=false;p.resume(settings);await tick();p.stop();assert.equal(p.state,'idle');
 await p.start(['one'],settings);await tick();assert.equal(p.state,'playing');
 assert.equal(calls.filter(([,o])=>o.method==='POST').length,1);await p.invalidate();
});
test('failed generation stops playback and does not offer incomplete exports',async()=>{
 const {p,setSnapshot}=setup();await p.start(['one','two'],settings);await tick();
 setSnapshot({state:'failed',starts:[.046],duration:2,error:'Failed'});await p.refresh();
 assert.equal(p.state,'failed');assert.equal(p.audio.paused,true);assert.equal(p.download('mp3'),null);await p.invalidate();
});
test('stop cancels incomplete generation and releases media handlers',async()=>{
 const {p,calls,handlers}=setup();await p.start(['one','two'],settings);await tick();p.stop();await tick();
 assert.equal(p.id,null);assert.equal(p.state,'idle');assert.equal(handlers.play,null);
 assert.equal(calls.filter(([,o])=>o.method==='DELETE').length,1);
});

test('completed file takes over for a seek beyond the live stream buffer',async()=>{
 const {p,audio,setSnapshot}=setup();await p.start(['one','two'],settings);await tick();
 audio.buffered={length:1,start:()=>0,end:()=>1};audio.readyState=0;p.move(1);
 assert.equal(p.state,'preparing');
 setSnapshot({state:'ready',starts:[.046,2.046],duration:4.1});await p.refresh();
 assert.ok(audio.src.endsWith('?complete=1'));assert.equal(p.pendingIndex,1);
 audio.readyState=1;audio.dispatchEvent(new Event('loadedmetadata'));await tick();
 assert.equal(audio.currentTime,2.046);assert.equal(p.state,'playing');assert.equal(p.index,1);
 p.seekTo(3);await tick();assert.equal(audio.currentTime,3);assert.equal(p.index,1);await p.invalidate();
});
test('a superseded play promise cannot pause a newer seek',async()=>{
 const {p,audio,setSnapshot}=setup();await p.start(['one','two'],settings);await tick();
 setSnapshot({state:'ready',starts:[.046,2.046],duration:4.1});await p.refresh();
 let reject;const native=audio.play.bind(audio);audio.play=()=>new Promise((_,r)=>reject=r);
 void p.play();audio.play=native;p.move(1);await tick();reject(Error('interrupted'));await tick();
 assert.equal(p.state,'playing');assert.equal(p.wantPlay,true);await p.invalidate();
});

test('switching provider creates a new reading while changing speed reuses it',async()=>{
 const {p,calls}=setup();await p.start(['one'],settings);await tick();
 await p.start(['one'],{...settings,provider:'deepinfra'});await tick();
 const posts=calls.filter(([,o])=>o.method==='POST');assert.equal(posts.length,2);
 assert.equal(JSON.parse(posts[1][1].body).provider,'deepinfra');
 p.setRate(1.5);assert.equal(calls.filter(([,o])=>o.method==='POST').length,2);await p.invalidate();
});
test('a new reading waits for an earlier stop to release the service',async()=>{
 const {p,calls}=setup();await p.start(['one'],settings);await tick();
 const fetcher=p.fetcher;let finish;
 p.fetcher=(url,options={})=>options.method==='DELETE'?new Promise(r=>finish=r):fetcher(url,options);
 p.stop();const next=p.start(['two'],settings);await tick();
 assert.equal(calls.filter(([,o])=>o.method==='POST').length,1);
 finish({ok:true});await next;await tick();
 assert.equal(calls.filter(([,o])=>o.method==='POST').length,2);
 p.fetcher=fetcher;await p.invalidate();
});

test('a generated live section can seek beyond Chrome prefetch without waiting for completion',async()=>{
 const {p,audio,setSnapshot}=setup();await p.start(['one','two','three'],settings);await tick();
 audio.buffered={length:1,start:()=>0,end:()=>1};audio.readyState=1;p.move(1);
 setSnapshot({state:'generating',starts:[.046,2.046],duration:4.046});await p.refresh();await tick();
 assert.equal(audio.currentTime,2.046);assert.equal(p.state,'playing');assert.equal(p.index,1);
 assert.equal(p.complete,false);assert.equal(p.seekableFile,false);await p.invalidate();
});

const fullSettings={...settings,provider:'google',delivery:'complete'};
test('complete delivery reports preparation but never loads partial audio',async()=>{
 const {p,audio,calls,setSnapshot}=setup();audio.readyState=0;
 const messages=[];p.onChange=(_,message)=>messages.push(message);
 await p.start(['one','two','three'],fullSettings);await tick();
 assert.equal(audio.src,undefined);assert.equal(audio.paused,true);assert.equal(p.state,'preparing');
 assert.ok(messages.includes('Preparing the full reading · 1 of 3 sections'));
 p.resume(fullSettings);await tick();assert.equal(audio.src,undefined);assert.equal(audio.paused,true);
 setSnapshot({state:'ready',starts:[0,2,4],duration:6});await p.refresh();
 assert.ok(audio.src.endsWith('/job/audio?complete=1'));assert.equal(audio.paused,true);
 audio.readyState=1;audio.dispatchEvent(new Event('loadedmetadata'));await tick();
 assert.equal(p.state,'playing');assert.equal(p.index,0);assert.equal(p.seekableFile,true);
 p.seekTo(4.5);await tick();assert.equal(p.index,2);assert.equal(audio.currentTime,4.5);
 assert.equal(calls.filter(([,o])=>o.method==='POST').length,1);await p.invalidate();
});
test('pause and selection during full preparation survive completion without autoplay',async()=>{
 const {p,audio,setSnapshot,calls}=setup();audio.readyState=0;
 await p.start(['one','two','three'],fullSettings);await tick();p.pause();p.move(1);
 assert.equal(p.pendingIndex,1);assert.equal(audio.src,undefined);
 setSnapshot({state:'ready',starts:[0,2,4],duration:6});await p.refresh();
 audio.readyState=1;audio.dispatchEvent(new Event('loadedmetadata'));await tick();
 assert.equal(audio.paused,true);assert.equal(p.index,1);assert.equal(audio.currentTime,2);
 p.resume(fullSettings);await tick();assert.equal(p.state,'playing');
 p.setRate(1.5);audio.currentTime=4.1;p.sync();assert.equal(p.index,2);
 assert.equal(calls.filter(([,o])=>o.method==='POST').length,1);await p.invalidate();
});
test('failure during full preparation exposes neither partial audio nor exports',async()=>{
 const {p,audio,setSnapshot}=setup();audio.readyState=0;
 await p.start(['one','two'],fullSettings);await tick();
 setSnapshot({state:'failed',starts:[0],duration:2,error:'Preparation failed'});await p.refresh();
 assert.equal(p.state,'failed');assert.equal(audio.src,undefined);assert.equal(p.download('mp3'),null);
 assert.equal(audio.paused,true);await p.invalidate();
});
test('stop during full preparation cancels once and prevents late audio attachment',async()=>{
 const {p,audio,calls,setSnapshot}=setup();audio.readyState=0;
 await p.start(['one','two'],fullSettings);await tick();p.stop();await tick();
 setSnapshot({state:'ready',starts:[0,2],duration:4});await p.refresh();
 assert.equal(p.id,null);assert.equal(audio.src,undefined);assert.equal(p.state,'idle');
 assert.equal(calls.filter(([,o])=>o.method==='DELETE').length,1);
});
