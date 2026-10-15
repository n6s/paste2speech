// Actual built readers, real MP3/MSE decoding, synthetic account/provider APIs.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
import assert from 'node:assert/strict';
const out='work/paste-promotion-2026-10-11';await mkdir(out,{recursive:true});
const bytes=await Promise.all([0,1,2].map(i=>readFile(`tests/fixtures/wavenet/en-US-Wavenet-F-0${i}.mp3`)));
let duration=0;const sections=Array.from({length:90},(_,index)=>{const m=inspectMp3(bytes[index%3]),s={index,start:duration,samples:m.samples,bytes:m.bytes};duration+=m.samples/24000;return s;});
const text=sections.map((_,index)=>`Section ${index+1}.`).join('\n\n');
let site;const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',/\.(js|mjs)$/.test(path)?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(site+'/'+(path==='/'?'index.html':path.slice(1))));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}),results=[];
try{for(const [environment,root] of Object.entries({staging:'work/private-reader/site',public:'work/production-reader/site'})){
 site=root;const release=JSON.parse(await readFile(site+'/release.json','utf8'));
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 let blocked=false,hold=true,releaseHeld,id,active=0,peak=0;const held=new Promise(r=>releaseHeld=r),posts=[],sectionGets=[],offlineRequests=[],external=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{localStorage.setItem('paste2speech.settings',JSON.stringify({engine:'google',workstationVoice:'en-US-Wavenet-F',joinLines:false}));window.__audio=[];const Original=window.Audio;window.Audio=function(...args){const audio=new Original(...args);__audio.push(audio);return audio;};});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(url.origin!==origin){external.push(url.origin);return route.abort();}
  if(!path.startsWith('/api/'))return route.continue();
  if(blocked){offlineRequests.push({path,method:request.method()});return route.abort('internetdisconnected');}
  if(path==='/api/reader')return route.fulfill({json:{eligible:true,accessAllowed:true,account:{balance:1000000}}});
  if(path==='/api/readings'&&request.method()==='POST'){id=request.headers()['idempotency-key'];assert.equal(request.postDataJSON().chunks.length,90);posts.push(id);return route.fulfill({json:{id}});}
  if(request.method()==='DELETE')return route.fulfill({status:204});
  const section=path.match(/\/sections\/(\d+)$/);
  if(section){const index=Number(section[1]);sectionGets.push(index);peak=Math.max(peak,++active);try{if(index>=3&&hold)await held;return await route.fulfill({contentType:'audio/mpeg',body:bytes[index%3]});}finally{active--;}}
  if(path==='/api/readings/'+id)return route.fulfill({json:{id,state:'ready',completed:90,total:90,sections,starts:sections.map(s=>s.start),duration}});
  return route.fulfill({json:{available:false}});
 });
 await page.goto(origin);assert.equal(await page.locator('#paste').count(),1);assert.equal(await page.locator('#offline-progress').count(),1);assert.equal(await page.locator('#paste-check').count(),0);
 await page.locator('#voice-settings').evaluate(el=>el.open=true);await page.locator('#engine').selectOption('google');
 await page.locator('#text').fill(text);await page.locator('#play').click();
 await page.waitForFunction(()=>__audio.some(a=>a.currentTime>.1));
 assert.match(await page.locator('#offline-progress').textContent(),/Downloading/,'Playback must precede whole-reading readiness');
 hold=false;releaseHeld();await page.waitForFunction(()=>document.querySelector('#offline-progress').textContent.startsWith('Ready for offline listening'));
 assert.equal(posts.length,1);assert.equal(sectionGets.length,90);assert.equal(new Set(sectionGets).size,90);assert.ok(peak<=3,`Concurrency ${peak}`);
 await page.locator('#pause').click();blocked=true;await context.setOffline(true);assert.equal(await page.evaluate(()=>navigator.onLine),false);
 for(const index of [88,0,50]){
  await page.locator('#seek').evaluate((el,index)=>{el.value=String(index);el.dispatchEvent(new Event('change',{bubbles:true}));},index);
  await page.waitForFunction(start=>__audio.some(a=>a.src.startsWith('blob:')&&Math.abs(a.currentTime-start)<.5),sections[index].start);
  if(await page.locator('main.staging-reader-layout').count()){const clock=n=>`${Math.floor(n/60)}:${String(Math.floor(n)%60).padStart(2,'0')}`;assert.equal(await page.locator('#seek-time').textContent(),`${clock(sections[index].start)} / ${clock(duration)}`);}else assert.equal(await page.locator('#seek-time').textContent(),`${index+1} / 90`);
  const before=await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).currentTime);
  await page.locator('#play').click();await page.waitForFunction(before=>__audio.some(a=>a.currentTime>before+.05&&!a.paused),before);await page.locator('#pause').click();
 }
 assert.match(await page.locator('#offline-progress').textContent(),/^Ready for offline listening/);assert.equal(posts.length,1);assert.equal(sectionGets.length,90);
 assert.deepEqual(offlineRequests.filter(r=>r.path!=='/api/events'),[],'Offline playback must use retained sections without requests or another job');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 results.push({environment,commit:release.commit,dirty:release.dirty,earlyPlaybackBeforeReadiness:true,retainedSections:90,maximumConcurrentSectionGets:peak,offlineSeekSections:[89,1,51],offlinePauseResume:true,syntheticJobPosts:posts.length,newSpeechJobsWhileOffline:0,sectionReadsWhileOffline:0,pageErrors:errors,externalRequests:external});
 blocked=false;await context.setOffline(false);await page.locator('#clear').click();assert.equal(await page.locator('#text').inputValue(),'');assert.equal(await page.locator('#offline-progress').isVisible(),false);
 if(environment==='public'){await page.goto(origin+'/?testing=1');assert.equal(await page.locator('#paste').count(),1);assert.equal(await page.locator('#paste-check, #staging-checks, #testing-mode-link').count(),0);assert.equal(await page.evaluate(()=>typeof window.__stagingReader),'undefined');}
 await context.close();console.log(`PASS built ${environment}: early playback, all 90 sections retained, offline seeks beyond bounded buffer, pause/resume, one synthetic job and no new network/provider reads; public diagnostics excluded.`);
}}
finally{await browser.close();await new Promise(r=>server.close(r));}
await writeFile(out+'/built-offline.json',JSON.stringify({clipboardOrProviderCredentialsUsed:false,realSpeechOrOCRCalls:0,retention:'Current tab, existing 64 MiB bound; no offline reload/reopen guarantee',results},null,2)+'\n');
