// Real MSE decoding, synthetic APIs only. Includes the real-reading transport.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
const bytes=await Promise.all([0,1,2].map(i=>readFile(`tests/fixtures/wavenet/en-US-Wavenet-F-0${i}.mp3`)));
let duration=0;const sections=bytes.map((b,index)=>{const m=inspectMp3(b),s={index,start:duration,samples:m.samples,bytes:m.bytes};duration+=m.samples/24000;return s;});
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');
 if(path==='/')return res.end('<button id="resume">Resume</button><div id="status"></div>');
 if(path==='/public/config.js')return res.end('export const MSE_FIXTURE_VERSION="",MSE_STAGING=false,LONG_READINGS=true;');
 res.end(await readFile('.'+path));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}),results=[];
try{for(const scenario of ['poll-buffered','boundary','download','failed','404','expired','cancelled','stop','clear']){
 if(process.env.RECOVERY_CASE&&scenario!==process.env.RECOVERY_CASE)continue;
 const context=await browser.newContext(),page=await context.newPage(),posts=[],errors=[];let id,offline=false,ready=false,terminal=false,statusFailures=0,dialogs=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs++;await d.dismiss();});
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/reader')return route.fulfill({json:{account:{balance:1000000}}});
  if(path==='/api/billing/session')return route.fulfill({json:{}});
  if(path==='/api/readings'&&request.method()==='POST'){id=request.headers()['idempotency-key'];posts.push(id);return route.fulfill({json:{id}});}
  if(request.method()==='DELETE')return route.fulfill({status:204});
  const section=path.match(/\/sections\/(\d+)$/);
  if(section){if(scenario==='download'&&Number(section[1])>0&&offline)return route.abort('internetdisconnected');return route.fulfill({contentType:'audio/mpeg',body:bytes[Number(section[1])]});}
  assert.equal(path,'/api/readings/'+id);
  if(terminal&&scenario==='404')return route.fulfill({status:404,json:{detail:'Unavailable job'}});
  if(offline&&scenario!=='download'){statusFailures++;return statusFailures%2?route.abort('internetdisconnected'):route.fulfill({status:503,json:{detail:'Temporary outage'}});}
  const available=sections.slice(0,ready||scenario==='download'?3:scenario==='boundary'?1:2),state=terminal?scenario:ready||scenario==='download'?'ready':'preparing';
  return route.fulfill({json:{id,state,completed:available.length,total:3,sections:available,starts:available.map(s=>s.start),duration:available.at(-1).start+available.at(-1).samples/24000,error:terminal?'Server job '+scenario:''}});
 });
 await page.goto(origin);if(scenario==='download')offline=true;
 await page.evaluate(async()=>{
  const {StagingPlayer}=await import('/public/staging-player.js');window.player=new StagingPlayer(p=>document.querySelector('#status').textContent=p.error||p.state);
  document.querySelector('#resume').onclick=()=>player.resume();
  await player.start(['First section.','Second section.','Third section.'],{voice:'en-US-Wavenet-F',rate:.5,delivery:'mse'});
 });
 await page.waitForFunction(()=>player.audio.currentTime>.1);
 const original=await page.evaluate(()=>({job:player.job,src:player.audio.src,text:player.chunks.join('|')}));
 if(['failed','404','expired','cancelled'].includes(scenario)){
  terminal=true;
  if(scenario==='failed'){await page.waitForFunction(()=>player.status?.state==='failed');assert.equal(await page.evaluate(()=>player.audio.paused),false);await page.evaluate(()=>{player.audio.currentTime=player.ranges().at(-1)[1]-.02;player.setRate(2);});await page.waitForFunction(()=>player.state==='paused'&&!player.wantPlay);assert.equal(await page.evaluate(()=>!!player.fatal),false);}
  else{await page.waitForFunction(()=>player.state==='failed');assert.equal(await page.evaluate(()=>player.audio.paused&&player.fatal),true);}assert.equal(posts.length,1);
  await page.click('#resume');await page.waitForFunction(()=>!player.resuming);
  assert.equal(posts.length,1);assert.equal(dialogs,scenario==='failed'?1:0);
 }else if(scenario==='poll-buffered'){
  for(let cycle=0;cycle<3;cycle++){
   offline=true;await page.waitForFunction(()=>player.status?.connectionUnavailable);
   const before=await page.evaluate(()=>player.audio.currentTime);await page.waitForTimeout(450);
   const flowing=await page.evaluate(()=>({time:player.audio.currentTime,paused:player.audio.paused,state:player.state,fatal:player.fatal}));
   assert.ok(flowing.time>before+.1);assert.equal(flowing.paused,false);assert.equal(flowing.state,'playing');assert.equal(flowing.fatal,false);
   offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>!player.status?.connectionUnavailable&&!player.connectionInterrupted);
  }
  ready=true;await page.waitForFunction(()=>player.finalized);assert.equal(await page.evaluate(()=>player.audio.paused),false);
 }else if(['stop','clear'].includes(scenario)){
  offline=true;await page.waitForFunction(()=>player.status?.connectionUnavailable);
  await page.evaluate(clear=>clear?player.invalidate():player.stop(),scenario==='clear');await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>player.job),null);assert.equal(await page.evaluate(()=>player.state),'idle');
 }else{
  offline=true;await page.waitForFunction(()=>player.connectionInterrupted);
  const before=await page.evaluate(()=>player.audio.currentTime);await page.waitForTimeout(350);
  assert.ok(await page.evaluate(()=>player.audio.currentTime)>before+.1,'Buffered playback must continue during outage');
  await page.evaluate(()=>player.setRate(2));await page.waitForFunction(()=>player.state==='disconnected').catch(async error=>{console.log('BOUNDARY DEBUG',await page.evaluate(()=>({state:player.state,time:player.audio.currentTime,ranges:player.ranges(),wantPlay:player.wantPlay,paused:player.audio.paused,connection:player.connectionInterrupted,connectionPaused:player.connectionPaused,ready:player.audio.readyState,status:player.status,events:player.events.slice(-8)})));throw error;});
  const boundary=await page.evaluate(()=>({time:player.audio.currentTime,end:player.ranges().at(-1)[1],paused:player.audio.paused,fatal:player.fatal,ready:player.audio.readyState}));
  assert.ok(boundary.time>=boundary.end-.6);assert.equal(boundary.paused,true);assert.equal(boundary.fatal,false);assert.ok(boundary.ready<3);
  offline=false;ready=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>player.finalized&&!player.connectionInterrupted);
  assert.equal(await page.evaluate(()=>player.wantPlay),false,'Reconnection must not undo the boundary pause');
  const position=await page.evaluate(()=>player.audio.currentTime);await page.evaluate(()=>Promise.all([player.resume(),player.resume()]));await page.waitForFunction(()=>player.state==='playing');
  const after=await page.evaluate(()=>player.audio.currentTime);assert.ok(after>=position-.05&&after<position+1);
 }
 const final=await page.evaluate(()=>({job:player.job,src:player.audio.src,text:player.chunks.join('|')}));
 if(!['stop','clear'].includes(scenario))assert.deepEqual(final,original);
 assert.equal(posts.length,1,'No replacement paid creation');assert.deepEqual(errors,[]);
 results.push({scenario,posts:posts.length,statusFailures,dialogs,pageErrors:errors});
 offline=false;await page.evaluate(()=>player.invalidate());await context.close();console.log('PASS status recovery '+scenario+': buffered audio, saved IDs and terminal protections.');
}}
finally{await browser.close();await new Promise(r=>server.close(r));}
await mkdir('work/network-recovery-2026-10-10',{recursive:true});await writeFile('work/network-recovery-2026-10-10/status-recovery.json',JSON.stringify({paidCalls:0,liveInferenceCalls:0,results},null,2)+'\n');
