// Real desktop MSE/file playback; synthetic APIs reuse existing MP3 fixtures.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
const bytes=await Promise.all([0,1,2].map(i=>readFile(`tests/fixtures/wavenet/en-US-Wavenet-F-0${i}.mp3`)));
let duration=0;const sections=bytes.map((b,index)=>{const m=inspectMp3(b),s={index,start:duration,samples:m.samples,bytes:m.bytes};duration+=m.samples/24000;return s;});
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');
 if(path==='/')return res.end('<button id="resume">Resume</button><div id="status"></div>');
 if(path==='/public/config.js')return res.end('export const MSE_FIXTURE_VERSION="",MSE_STAGING=false,LONG_READINGS=true;');
 res.end(await readFile('.'+path));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{for(const scenario of ['ready','unfinished','decode','stop','clear','late-play']){
 const context=await browser.newContext(),page=await context.newPage(),posts=[];let id,ready=scenario!=='unfinished',holdAudio=false,releaseAudio;
 const pendingAudio=new Promise(r=>releaseAudio=r);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const r=route.request(),path=new URL(r.url()).pathname;
  if(path==='/api/reader')return route.fulfill({json:{account:{balance:1000000}}});
  if(path==='/api/billing/session')return route.fulfill({json:{}});
  if(path==='/api/readings'&&r.method()==='POST'){id=r.headers()['idempotency-key'];posts.push(id);return route.fulfill({json:{id}});}
  if(r.method()==='DELETE')return route.fulfill({status:204});
  if(path.endsWith('/audio')){if(holdAudio)await pendingAudio;const audio=Buffer.concat(bytes),range=r.headers().range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Number(range[2]):audio.length-1;return route.fulfill({status:range?206:200,contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})},body:audio.subarray(start,end+1)});}
  const section=path.match(/\/sections\/(\d+)$/);if(section)return route.fulfill({contentType:'audio/mpeg',body:bytes[Number(section[1])]});
  const available=sections.slice(0,ready?3:1);return route.fulfill({json:{id,state:ready?'ready':'preparing',completed:available.length,total:3,starts:available.map(s=>s.start),duration:ready?duration:sections[1].start,sections:available}});
 });
 await page.goto(origin);await page.evaluate(async()=>{
  const {StagingPlayer}=await import('/public/staging-player.js');window.player=new StagingPlayer(p=>document.getElementById('status').textContent=p.state);
  const audio=player.audio,load=audio.load.bind(audio);audio.load=()=>{delete audio.error;load();};
  window.mediaError=code=>{Object.defineProperty(audio,'error',{value:{code,message:'Synthetic interruption'},configurable:true});audio.dispatchEvent(new Event('error'));};
  document.getElementById('resume').onclick=()=>player.resume();
  await player.start(['First section.','Second section.','Third section.'],{voice:'en-US-Wavenet-F',rate:1,delivery:'mse'});
 });
 await page.waitForFunction(()=>player.audio.currentTime>.1);
 await page.evaluate(()=>player.pause());const before=await page.evaluate(()=>({job:player.job,time:player.audio.currentTime,src:player.audio.src,text:player.chunks.join('|')}));assert.equal(posts.length,1);
 if(scenario==='late-play'){
  await page.evaluate(async()=>{let rejectOld,resolveNew;player.audio.play=()=>new Promise((resolve,reject)=>{if(!rejectOld)rejectOld=reject;else resolveNew=resolve;});
   const old=player.play();player.pause();const fresh=player.play();resolveNew();await fresh;rejectOld(Object.assign(Error('Late rejection'),{name:'NotAllowedError'}));await old;
   if(!player.wantPlay||player.error)throw Error('Stale play promise changed current playback');player.pause();player.audio.dispatchEvent(new Event('playing'));if(player.state!=='paused')throw Error('Stale playing event changed paused state');player.release();player.audio.dispatchEvent(new Event('timeupdate'));if(navigator.mediaSession.playbackState!=='none')throw Error('Released player changed media session');});
 }else{
  await page.evaluate(code=>mediaError(code),scenario==='decode'?3:2);
  if(scenario==='decode'){
   const fault=await page.evaluate(()=>({fatal:player.fatal,recovery:player.mediaRecovery,state:player.state}));assert.equal(fault.fatal,true);assert.equal(fault.state,'failed');assert.ok(!fault.recovery);await page.click('#resume');assert.equal(posts.length,1);
  }else{
   const fault=await page.evaluate(()=>({state:player.state,fatal:player.fatal,aborted:player.controller.signal.aborted}));assert.equal(fault.state,'disconnected');assert.equal(fault.fatal,false);assert.equal(fault.aborted,true);
   if(['stop','clear'].includes(scenario))holdAudio=true;
   if(scenario==='ready'){await page.evaluate(()=>player.seekTo(2));before.time=2;}
   await page.evaluate(()=>Promise.all([player.resume(),player.resume()]));
   if(scenario==='stop'||scenario==='clear'){
    await page.waitForFunction(()=>player.finalized);
    await page.evaluate(clear=>clear?player.invalidate():player.stop(),scenario==='clear');holdAudio=false;releaseAudio();
    await page.waitForTimeout(200);const stopped=await page.evaluate(()=>({job:player.job,state:player.state,wantPlay:player.wantPlay,time:player.audio.currentTime}));assert.equal(stopped.state,'idle');assert.equal(stopped.wantPlay,false);
    if(scenario==='clear'){assert.equal(stopped.job,null);assert.equal(stopped.time,0);}else{await page.waitForFunction(()=>player.audio.readyState>=1);assert.equal(await page.evaluate(()=>player.audio.currentTime),0);await page.click('#resume');await page.waitForFunction(()=>player.audio.currentTime>.1);}
   }else{
    await page.waitForFunction(()=>player.state==='playing');const after=await page.evaluate(()=>({job:player.job,time:player.audio.currentTime,src:player.audio.src,text:player.chunks.join('|'),aborted:player.controller.signal.aborted}));assert.equal(after.job,before.job);assert.equal(after.text,before.text);assert.ok(after.time>=before.time-.05&&after.time<before.time+1);assert.equal(after.aborted,false);assert.notEqual(after.src,before.src);
    if(scenario==='unfinished'){assert.ok(after.src.startsWith('blob:'));ready=true;await page.waitForFunction(()=>player.finalized);}
    for(let n=0;n<3;n++){
     await page.evaluate(()=>player.pause());const time=await page.evaluate(()=>player.audio.currentTime);await page.evaluate(()=>mediaError(2));await page.click('#resume');await page.waitForFunction(()=>player.state==='playing');assert.ok(await page.evaluate(()=>player.audio.currentTime)>=time-.05);
    }
    await page.evaluate(()=>player.stop());await page.evaluate(()=>player.start(player.chunks,player.settings));await page.waitForFunction(()=>player.state==='playing');
   }
  }
 }
 assert.equal(posts.length,1,'Recovery must not create replacement speech');assert.deepEqual(errors,[]);releaseAudio();await page.evaluate(()=>player.invalidate());await context.close();console.log('PASS media recovery '+scenario+': same paid job, state/position preserved, no stale replay.');
}}finally{await browser.close();await new Promise(r=>server.close(r));}
