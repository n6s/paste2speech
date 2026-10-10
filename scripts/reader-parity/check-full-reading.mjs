// Full-reading local retention, real Chrome MSE, synthetic provider/account APIs.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
const bytes=await Promise.all([0,1,2].map(i=>readFile(`tests/fixtures/wavenet/en-US-Wavenet-F-0${i}.mp3`)));
let duration=0;const sections=Array.from({length:90},(_,index)=>{const info=inspectMp3(bytes[index%3]),section={index,start:duration,samples:info.samples,bytes:info.bytes};duration+=info.samples/24000;return section;});
const chunks=sections.map((_,i)=>`Section ${i+1}.`);
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');
 if(path==='/')return res.end('<button id="resume">Resume</button><div id="status"></div>');
 if(path==='/public/config.js')return res.end('export const MSE_FIXTURE_VERSION="",MSE_STAGING=false,LONG_READINGS=true,FULL_AUDIO_PREFETCH=true;');
 res.end(await readFile('.'+path));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}),results=[];
try{for(const scenario of ['whole-offline','interrupted','cancel','evicted','reload']){
 const context=await browser.newContext(),page=await context.newPage(),posts=[],gets=[],errors=[];let id,offline=false,hold=true,release;
 const held=new Promise(r=>release=r);let active=0,peak=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(offline){gets.push({path,offline:true});return route.abort('internetdisconnected');}
  if(path==='/api/reader')return route.fulfill({json:{account:{balance:1000000}}});
  if(path==='/api/billing/session')return route.fulfill({json:{}});
  if(path==='/api/readings'&&request.method()==='POST'){id=request.headers()['idempotency-key'];posts.push(id);return route.fulfill({json:{id}});}
  if(request.method()==='DELETE')return route.fulfill({status:204});
  const section=path.match(/\/sections\/(\d+)$/);
  if(section){const index=Number(section[1]);gets.push({path,index});peak=Math.max(peak,++active);try{if(index>=3&&hold)await held;await new Promise(r=>setTimeout(r,15));return await route.fulfill({contentType:'audio/mpeg',body:bytes[index%3]});}finally{active--;}}
  assert.equal(path,'/api/readings/'+id);gets.push({path});return route.fulfill({json:{id,state:'ready',completed:90,total:90,sections,starts:sections.map(s=>s.start),duration}});
 });
 await page.goto(origin);await page.evaluate(async chunks=>{
  window.actions={};Object.defineProperty(navigator,'mediaSession',{value:{playbackState:'none',setActionHandler:(name,fn)=>actions[name]=fn,setPositionState(){}}});
  const {StagingPlayer}=await import('/public/staging-player.js');window.player=new StagingPlayer(p=>document.querySelector('#status').textContent=p.error||p.state);
  await player.start(chunks,{voice:'en-US-Wavenet-F',rate:1,delivery:'mse'});
 },chunks);
 await page.waitForFunction(()=>player.audio.currentTime>.1);assert.equal(await page.evaluate(()=>player.offlineInfo.ready),false,'Start playback before the whole download');
 if(scenario==='cancel'){
  await page.evaluate(()=>player.invalidate());hold=false;release();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>player.job),null);assert.equal(await page.evaluate(()=>player.longReadings.assets.bytes),0);
 }else{
  if(scenario==='interrupted'){offline=true;hold=false;release();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>player.offlineInfo.ready),false);offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));}
  else{hold=false;release();}
  await page.waitForFunction(()=>player.offlineInfo.ready);assert.equal(posts.length,1);assert.ok(peak<=3,`Download concurrency ${peak}`);
  if(scenario==='whole-offline'){const sectionGets=gets.filter(g=>g.index!=null);assert.equal(sectionGets.length,90);assert.equal(new Set(sectionGets.map(g=>g.index)).size,90);}
  const beforeGets=gets.length,original=await page.evaluate(()=>({job:player.job,src:player.audio.src}));offline=true;
  if(scenario==='evicted'){
   await page.evaluate(()=>player.longReadings.assets.evict(player.getVideoPreparation().session.records[0].id,50));assert.equal(await page.evaluate(()=>player.offlineInfo.ready),false);
  }else if(scenario==='reload'){
   await page.reload();assert.equal(await page.evaluate(()=>typeof window.player),'undefined');assert.equal(posts.length,1);assert.equal(gets.length,beforeGets);
  }else{
   for(const time of [250,0,400,10]){
    await page.evaluate(time=>player.seekTo(time),time);await page.waitForFunction(time=>Math.abs(player.audio.currentTime-time)<.5,time);
   }
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});const backgroundTime=await page.evaluate(()=>player.audio.currentTime);await page.waitForFunction(time=>player.audio.currentTime>time+.1,backgroundTime);await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
   const media=await page.evaluate(async()=>{actions.pause();const paused=player.audio.paused;actions.play();await new Promise(r=>setTimeout(r,50));return {paused,playing:!player.audio.paused,state:navigator.mediaSession.playbackState};});assert.equal(media.paused,true);assert.equal(media.playing,true);assert.equal(media.state,'playing');
   const assembled=await page.evaluate(async()=>{const {loadPreparedMedia}=await import('/public/prepared-media.js'),group=player.getVideoPreparation(),media=await loadPreparedMedia(group.session.records,{assets:group.session.assets});return {bytes:media.blob.size,duration:media.duration,cues:media.vtt.match(/ --> /g).length};});
   assert.equal(assembled.bytes,sections.reduce((n,s)=>n+s.bytes,0));assert.equal(assembled.duration,duration);assert.equal(assembled.cues,90);
   assert.equal(gets.length,beforeGets,'Offline seeking and export assembly require no network reads');assert.equal(posts.length,1);
   await page.evaluate(()=>player.stop());await page.waitForFunction(()=>player.audio.currentTime===0&&player.pendingIndex==null);assert.equal(await page.evaluate(()=>player.audio.paused),true);assert.equal(await page.evaluate(()=>player.offlineInfo.ready),true);await page.evaluate(()=>player.resume());await page.waitForFunction(()=>player.state==='playing');
   assert.equal(await page.evaluate(()=>player.job),original.job);assert.equal(await page.evaluate(()=>player.audio.src),original.src);
  }
 }
 assert.deepEqual(errors,[]);results.push({scenario,jobPosts:posts.length,peakDownloadConcurrency:peak,sectionGets:gets.filter(g=>g.index!=null).length,pageErrors:errors});
 offline=false;hold=false;release();if(scenario!=='reload')await page.evaluate(()=>player.invalidate());await context.close();console.log('PASS full reading '+scenario+': early playback, shared bytes, no new synthesis.');
}}
finally{await browser.close();await new Promise(r=>server.close(r));}
await mkdir('work/network-recovery-2026-10-10',{recursive:true});await writeFile('work/network-recovery-2026-10-10/full-reading.json',JSON.stringify({retention:'Current tab only; reload clears readiness and audio',paidCalls:0,liveInferenceCalls:0,results},null,2)+'\n');
