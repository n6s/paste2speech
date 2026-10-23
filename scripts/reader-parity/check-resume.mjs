// Real MSE playback with synthetic API responses: no provider calls or credits.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
const bytes=await Promise.all([0,1,2].map(i=>readFile(`tests/fixtures/wavenet/en-US-Wavenet-F-0${i}.mp3`)));
const metadata=bytes.map(b=>inspectMp3(b));
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://local').pathname;
  res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');
  if(path==='/')return res.end('<button id="resume">Resume</button><div id="status"></div>');
  if(path==='/public/config.js')return res.end('export const MSE_FIXTURE_VERSION="",MSE_STAGING=false,LONG_READINGS=true;');
  res.end(await readFile('.'+path));
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 for(const failure of ['failed','network','within-failed','cancel-buffer','credit']){
  const context=await browser.newContext(),page=await context.newPage();
  const jobs=new Map(),posts=[];let interruptedAt,failedId,allowRecovery=false,dialogs=0;
  await page.route('**/api/**',async route=>{
   const r=route.request(),path=new URL(r.url()).pathname;
   if(path==='/api/reader')return route.fulfill({json:{account:{balance:1000000}}});
   if(path==='/api/billing/session')return route.fulfill({json:{}});
   if(path==='/api/readings'){
    const input=r.postDataJSON(),id=r.headers()['idempotency-key'],part=input.chunks[0][0]==='A'?0:1;
    posts.push({id,part});if(part===1&&!failedId)failedId=id;
    if(failure==='credit'&&part===1&&!allowRecovery){interruptedAt??=Date.now();return route.fulfill({status:402,json:{detail:'Insufficient credit'}});}
    jobs.set(id,{part,created:Date.now()});
    return route.fulfill({json:{id}});
   }
   const [,id,section]=path.match(/^\/api\/readings\/([^/]+)(?:\/sections\/(\d+))?$/)||[];
   const job=jobs.get(id);assert.ok(job);
   if(section!=null)return route.fulfill({contentType:'audio/mpeg',body:bytes[job.part===0?0:failure==='within-failed'&&allowRecovery?2:1+Number(section)]});
   if(job.part===1&&id===failedId&&!allowRecovery&&Date.now()-job.created>=(failure==='within-failed'?5800:1200)){
    interruptedAt??=Date.now();
    if(failure==='network')return route.fulfill({status:503,json:{detail:'Temporary connection failure'}});
    return route.fulfill({json:{id,state:'failed',completed:1,total:2,starts:[0],duration:metadata[1].samples/24000,sections:[{index:0,start:0,samples:metadata[1].samples,bytes:bytes[1].length}],error:'Preparation interrupted'}});
   }
   const indexes=job.part===0?[0]:id===failedId&&!allowRecovery?[1]:[1,2];let duration=0;
   const sections=indexes.map((n,index)=>{if(job.part===1&&failure==='within-failed'&&allowRecovery)n=2;const value={index,start:duration,samples:metadata[n].samples,bytes:bytes[n].length};duration+=value.samples/24000;return value;});
   const ready=job.part===0||allowRecovery;
   return route.fulfill({json:{id,state:ready?'ready':'preparing',sections,starts:sections.map(s=>s.start),duration,total:job.part===0?1:2,completed:sections.length}});
  });
  await page.goto(origin);
  await page.evaluate(async()=>{
   const {StagingPlayer}=await import('/public/staging-player.js');
   window.player=new StagingPlayer(p=>document.getElementById('status').textContent=p.state);
   player.longReadings.limit=()=>100;
   document.getElementById('resume').onclick=()=>player.resume();
   await player.start(['A'.repeat(100),'B'.repeat(50),'C'.repeat(50)],{voice:'en-US-Wavenet-F',rate:1,delivery:'mse'});
  });
  await page.waitForFunction(()=>player.audio.currentTime>.1);
  if(failure==='credit'){
   await page.waitForFunction(()=>player.state==='paused'&&player.status?.state==='credit-paused');
   const drained=await page.evaluate(()=>({time:player.audio.currentTime,end:player.ranges().at(-1)[1],error:player.error}));
   assert.ok(drained.time>=drained.end-.25,'Paid audio must play to its buffered end');assert.match(drained.error,/insufficient speech credit/);
  }else if(failure==='network')await page.waitForFunction(()=>player.state==='disconnected');
  else{await page.waitForFunction(()=>player.status?.state==='failed');await page.waitForFunction(()=>player.state==='paused'&&!player.wantPlay);assert.equal(await page.evaluate(()=>!!player.fatal),false,'available prefix failure is recoverable, not fatal');}
  const before=await page.evaluate(()=>({time:player.audio.currentTime,src:player.audio.src,job:player.job}));
  assert.equal(posts.length,2);assert.ok(interruptedAt);
  if(!['network','credit'].includes(failure)){
   page.once('dialog',async d=>{dialogs++;assert.match(d.message(),/may use credit/);await d.dismiss();});
   await page.click('#resume');await page.waitForFunction(()=>!player.resuming);
   assert.equal(posts.length,2);assert.equal(await page.evaluate(()=>player.audio.currentTime),before.time);
   page.once('dialog',async d=>{dialogs++;allowRecovery=true;await d.accept();});
  }else allowRecovery=true;
  if(failure==='cancel-buffer')await page.evaluate(()=>Object.defineProperty(player.buffer,'updating',{get:()=>true}));
  await page.click('#resume');
  if(failure==='cancel-buffer'){
   await page.waitForFunction(()=>player.resuming&&!player.fatal);
   await page.evaluate(()=>player.invalidate());await page.waitForFunction(()=>!player.resuming);
   assert.equal(await page.evaluate(()=>player.state),'idle');assert.ok(posts.length<=3);
   await context.close();console.log('PASS Resume cancellation interrupts an in-flight buffer wait');continue;
  }
  await page.waitForFunction(()=>player.finalized);
  const after=await page.evaluate(()=>({time:player.audio.currentTime,src:player.audio.src,job:player.job,error:player.error,state:player.state,duration:player.audio.duration}));
  assert.equal(after.src,before.src);assert.equal(after.job,before.job);// Legacy whole-part replacement can have a shorter first section. At its old
  // end, keep the same logical section and clamp inside its new final frame.
  const expectedPlace=failure==='within-failed'?Math.min(before.time,(metadata[0].samples+metadata[2].samples-1)/24000):before.time;
  assert.ok(after.time>=expectedPlace-.05,JSON.stringify({failure,before,after}));assert.ok(after.time<expectedPlace+2);
  assert.equal(after.error,'');assert.equal(posts.filter(p=>p.part===0).length,1);
  assert.equal(posts.length,failure!=='network'?3:2);assert.equal(dialogs,['network','credit'].includes(failure)?0:2);
  if(failure==='credit')assert.equal(posts[1].id,posts[2].id);
  const expected=failure==='within-failed'?(metadata[0].samples+2*metadata[2].samples)/24000:metadata.reduce((n,m)=>n+m.samples/24000,0);
  assert.ok(Math.abs(after.duration-expected)<1/24000);
  if(failure==='within-failed')assert.ok(before.time>metadata[0].samples/24000,'Test must be listening inside the replaced part');
  await context.close();console.log(`PASS Resume ${failure}: completed parts reused, position/source retained, ${posts.length} total job creations`);
 }
 // Whole-reading preflight, single-part 402, full preparation, and file fallback.
 for(const scenario of ['single','multipart','single-race','full-race','fallback-race']){
  const context=await browser.newContext(),page=await context.newPage(),jobs=new Map(),posts=[];
  const multipart=!scenario.startsWith('single'),race=scenario.endsWith('race');
  let balance=race?200:1,recovered=false;
  await page.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path==='/api/reader')return route.fulfill({json:{account:{balance}}});
   if(path==='/api/billing/session')return route.fulfill({json:{}});
   if(path==='/api/readings'){
    const id=request.headers()['idempotency-key'],input=request.postDataJSON(),part=input.chunks[0][0]==='A'?0:1;posts.push({id,part});
    if(race&&!recovered&&(!multipart||part===1))return route.fulfill({status:402,json:{detail:'Balance changed after preflight'}});
    if(!jobs.has(id)){balance-=input.chunks.reduce((n,t)=>n+[...t].length,0);jobs.set(id,part);}
    return route.fulfill({json:{id}});
   }
   const match=path.match(/^\/api\/readings\/([^/]+)(?:\/sections\/(\d+))?$/),part=match&&jobs.get(match[1]);assert.notEqual(part,undefined);
   if(match[2]!=null)return route.fulfill({contentType:'audio/mpeg',body:bytes[part]});
   if(path.endsWith('/audio'))throw Error('unreachable');
   return route.fulfill({json:{state:'ready',completed:1,total:1,duration:metadata[part].samples/24000,starts:[0],sections:[{index:0,start:0,samples:metadata[part].samples,bytes:bytes[part].length}]}});
  });
  // Full files use cached fixture bytes; never call a provider.
  await page.route('**/api/readings/*/download/mp3',route=>route.fulfill({contentType:'audio/mpeg',body:bytes[jobs.get(new URL(route.request().url()).pathname.split('/')[3])]}));
  await page.route('**/api/readings/*/audio',route=>route.fulfill({contentType:'audio/mpeg',body:bytes[0]}));
  await page.goto(origin);
  await page.evaluate(async({multipart,scenario})=>{
   const {StagingPlayer}=await import('/public/staging-player.js');window.player=new StagingPlayer(()=>{});
   player.longReadings.limit=()=>multipart?100:20000;
   document.getElementById('resume').onclick=()=>player.resume();
   await player.start(multipart?['A'.repeat(100),'B'.repeat(100)]:['A'.repeat(100)],{voice:'en-US-Wavenet-F',rate:1,delivery:scenario==='full-race'?'complete':'mse'});
  },{multipart,scenario});
  await page.waitForFunction(()=>player.status?.state==='credit-paused');
  if(scenario==='fallback-race')await page.evaluate(()=>player.useCompletedFile());
  if(scenario==='full-race'||scenario==='fallback-race')await page.waitForFunction(()=>player.state==='paused');
  if(!race){await page.waitForFunction(()=>player.state==='paused');assert.equal(posts.length,0);assert.equal(balance,1);const message=await page.evaluate(()=>player.error);assert.match(message,/credits; 1 available/);}
  const before=await page.evaluate(()=>({job:player.job,src:player.audio.src,time:player.audio.currentTime}));
  await page.evaluate(async()=>{await Promise.all([player.resume(),player.resume()]);});
  await page.waitForFunction(()=>player.status?.state==='credit-paused');
  const refused=posts.at(-1)?.id,count=posts.length;
  balance=multipart?(race?100:200):100;recovered=true;
  await page.evaluate(async()=>{await Promise.all([player.resume(),player.resume()]);});
  await page.waitForFunction(()=>player.finalized);
  assert.equal(await page.evaluate(()=>player.job),before.job);
  if(!scenario.includes('full')&&!scenario.includes('fallback'))assert.equal(await page.evaluate(()=>player.audio.src),before.src);
  if(race)assert.equal(posts.at(-1).id,refused);
  assert.equal(posts.length-count,race?1:multipart?2:1);assert.equal(balance,0);
  const finalPosts=posts.length;await page.evaluate(()=>player.resume());await page.waitForTimeout(100);assert.equal(posts.length,finalPosts);
  await context.close();console.log(`PASS Credit ${scenario}: preflight/repeated Resume/top-up reuse without duplicate billing`);
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
