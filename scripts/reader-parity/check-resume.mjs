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
  }else await page.waitForFunction(()=>player.state==='failed');
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
  assert.equal(after.src,before.src);assert.equal(after.job,before.job);assert.ok(after.time>=before.time);assert.ok(after.time<before.time+2);
  assert.equal(after.error,'');assert.equal(posts.filter(p=>p.part===0).length,1);
  assert.equal(posts.length,failure!=='network'?3:2);assert.equal(dialogs,['network','credit'].includes(failure)?0:2);
  if(failure==='credit')assert.equal(posts[1].id,posts[2].id);
  const expected=failure==='within-failed'?(metadata[0].samples+2*metadata[2].samples)/24000:metadata.reduce((n,m)=>n+m.samples/24000,0);
  assert.ok(Math.abs(after.duration-expected)<1/24000);
  if(failure==='within-failed')assert.ok(before.time>metadata[0].samples/24000,'Test must be listening inside the replaced part');
  await context.close();console.log(`PASS Resume ${failure}: completed parts reused, position/source retained, ${posts.length} total job creations`);
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
