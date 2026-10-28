import test from 'node:test';
import assert from 'node:assert/strict';
import {Player} from '../public/player.js';
import {audioWaitMessage} from '../public/processing-indicator.js';
const setup=(trackStart=true)=>{
 const spoken=[],synth={cancel(){},speak(u){spoken.push(u);}},Utterance=class{constructor(text){this.text=text;}};
 const player=new Player(synth,Utterance,()=>{},{trackStart});
 return {player,spoken};
};
test('device speech waits for its first start, then stays started across automatic chunks',t=>{
 const {player:p,spoken}=setup();t.after(()=>p.stop());
 p.start(['first','second'],{rate:1});assert.equal(audioWaitMessage(p,{browser:true}),'Starting your device voice…');assert.equal(audioWaitMessage(p,{browser:true,creditPaused:true}),'Starting your device voice…');
 spoken[0].onstart();assert.equal(audioWaitMessage(p,{browser:true}),'');
 spoken[0].onend();assert.equal(p.starting,false);assert.equal(audioWaitMessage(p,{browser:true}),'');assert.equal(p.state,'playing');assert.equal(spoken[1].text,'second');
 spoken[1].onboundary({name:'word',charIndex:0});assert.equal(p.starting,false);
 spoken[1].onend();assert.equal(p.state,'done');assert.equal(p.starting,false);assert.equal(audioWaitMessage(p,{browser:true}),'');
});
test('device cancellation and failures dismiss waiting; stale speech cannot dismiss a new wait',t=>{
 const {player:p,spoken}=setup();t.after(()=>p.stop());p.start(['old'],{rate:1});const old=spoken[0];
 p.pause();old.onstart();assert.equal(p.starting,false);assert.equal(audioWaitMessage(p,{browser:true}),'');
 p.resume({rate:1});const current=spoken[1];old.onstart();old.onboundary({name:'word',charIndex:0});assert.equal(p.starting,true);
 current.onerror({error:'not-allowed'});assert.equal(p.state,'paused');assert.equal(p.starting,false);
 p.resume({rate:1});p.stop();spoken.at(-1).onstart();assert.equal(audioWaitMessage(p,{browser:true}),'');
 p.start(['new'],{rate:1});old.onend();assert.equal(p.starting,true);
});
test('Pause and Stop win during a sentence handoff, and a failed continuation never skips text',t=>{
 const {player:p,spoken}=setup();t.after(()=>p.stop());p.start(['first','second','third'],{rate:1});spoken[0].onstart();spoken[0].onend();const pending=spoken[1];
 assert.equal(p.starting,false);p.pause();pending.onstart();pending.onend();assert.equal(p.state,'paused');assert.equal(p.index,1);assert.equal(spoken.length,2);
 p.resume({rate:1});assert.equal(p.starting,true);assert.equal(spoken.at(-1).text,'second');spoken.at(-1).onstart();spoken.at(-1).onerror({error:'network'});assert.equal(p.state,'paused');assert.equal(p.index,1);assert.equal(spoken.length,3);
 p.resume({rate:1});const retry=spoken.at(-1);p.stop();retry.onstart();retry.onend();assert.equal(p.state,'idle');assert.equal(p.index,0);assert.equal(spoken.length,4);
});
test('startup tracking remains optional for existing public browser speech',t=>{
 const {player:p,spoken}=setup(false);t.after(()=>p.stop());p.start(['text'],{rate:1});
 assert.equal(p.state,'playing');assert.equal(p.starting,false);assert.equal(spoken[0].onstart,undefined);
});
test('cloud notices distinguish real waits from playback, pause, credit errors and offline audio',()=>{
 const p={state:'preparing',wantPlay:true,job:'job',audio:{paused:true}};
 assert.equal(audioWaitMessage(p),'Preparing audio…');p.state='buffering';assert.equal(audioWaitMessage(p),'Waiting for audio…');
 p.state='paused';assert.equal(audioWaitMessage(p),'Starting audio…');p.audio.paused=false;assert.equal(audioWaitMessage(p),'Starting audio…');p.state='ready';assert.equal(audioWaitMessage(p),'Starting audio…');p.audio.paused=true;
 p.wantPlay=false;assert.equal(audioWaitMessage(p),'');p.state='preparing';assert.equal(audioWaitMessage(p),'');
 p.wantPlay=true;p.state='playing';p.audio.paused=false;p.connectionInterrupted=true;p.offlineInfo={ready:true};assert.equal(audioWaitMessage(p),'');
 p.state='buffering';p.status={state:'credit-paused'};assert.equal(audioWaitMessage(p),'');p.status=null;
 assert.equal(audioWaitMessage(p,{creditPaused:true}),'');p.getVideoPreparation=()=>({error:{creditPaused:true}});assert.equal(audioWaitMessage(p),'');delete p.getVideoPreparation;
 for(const state of ['failed','disconnected','done','idle']){p.state=state;if(state==='idle')p.wantPlay=false;assert.equal(audioWaitMessage(p),'');}
});
