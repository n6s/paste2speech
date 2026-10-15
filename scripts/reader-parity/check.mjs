// The same browser checks exercise both built readers. All API requests are
// intercepted; synthetic fixtures never call a provider or alter an account.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
const sites={staging:'work/private-reader/site',production:'work/production-reader/site'};
const publicBuild=/RELEASE\s*=\s*["']production-public["']/.test(await readFile(sites.production+'/app.js','utf8'));
let assets;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;const file=path==='/'?'index.html':path.slice(1);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(`${assets}/${file}`));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true});
const bytes=await Promise.all(fixtures['en-US-Wavenet-F'].slice(0,3).map(p=>readFile('tests/fixtures/wavenet/'+p.file)));
let duration=0;
const sections=bytes.map((b,index)=>{const m=inspectMp3(b),part={index,start:duration,samples:m.samples,bytes:m.bytes};duration+=m.samples/24000;return part;});
let baseline;
try{
 for(const [environment,path] of Object.entries(sites)){
  assets=path;
  const context=await browser.newContext({viewport:{width:412,height:915}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let started,creates=0,deletes=0,reject=false,readingId;
  await page.addInitScript(()=>{const Original=window.Audio;window.__audio=[];window.Audio=function(...args){const a=new Original(...args);window.__audio.push(a);a.__loads=0;a.addEventListener('loadstart',()=>a.__loads++);return a;};window.__appends=0;const append=SourceBuffer.prototype.appendBuffer;SourceBuffer.prototype.appendBuffer=function(b){window.__appends++;return append.call(this,b);};});
  await page.route('**/api/**',async route=>{
   const r=route.request(),p=new URL(r.url()).pathname;let data={};if(r.method()==='DELETE')deletes++;
   if(p==='/api/reader')data={eligible:true,account:{balance:62100}};
   else if(p==='/api/readings'&&r.method()==='POST'){
    if(reject)return route.fulfill({status:403,json:{detail:'A clear server explanation.'}});
    const submitted=r.postDataJSON();started=Date.now();creates++;assert.equal(submitted.delivery,'mse');assert.equal(submitted.mseOptions,undefined);assert.equal(submitted.chunks.length,3);readingId=r.headers()['idempotency-key'];data={id:readingId};
   }else if(/\/sections\/[0-2]$/.test(p))return route.fulfill({contentType:'audio/mpeg',body:bytes[Number(p.at(-1))]});
   else if(p.endsWith('/audio')){
    const audio=Buffer.concat(bytes),range=r.headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):audio.length-1;
    return route.fulfill({status:range?206:200,contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})},body:audio.subarray(start,end+1)});
   }
   else if(p===`/api/readings/${readingId}`){
    const done=Date.now()-started>1700;data={id:'synthetic',state:done?'ready':'preparing',starts:sections.slice(0,done?3:1).map(s=>s.start),duration:done?duration:sections[1].start,completed:done?3:1,total:3,sections:sections.slice(0,done?3:1),delivery:'mse'};
   }
   await route.fulfill({json:data});
  });
  await page.goto(origin);assert.equal(await page.locator('#paste-check').count(),0);assert.equal(await page.locator('#paste').count(),environment==='staging'||publicBuild?1:0);assert.equal(await page.locator('#progress, #position').count(),0);assert.ok(await page.locator('#seek').isVisible());assert.equal(await page.locator('#seek-time').textContent(),environment==='staging'?'— / —':'0 / 0');await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
  assert.equal(await page.locator('#mse-delivery').inputValue(),'mse');
  assert.equal(await page.locator('#playback-options').evaluate(e=>e.open),false);
  assert.equal(await page.locator('#mse-delivery').isVisible(),false);
  assert.equal(await page.evaluate(()=>typeof window.__stagingReader),'undefined');
  assert.equal(await page.locator('#staging-checks').isVisible(),false);
  assert.equal(await page.getByText(environment==='staging'?'Download text-to-speech recording':'Download recording',{exact:true}).count(),1);
  if(environment==='staging')assert.equal(await page.locator('.download-card > #video-download').count(),1);
  const controls=await page.locator('#recording-controls').evaluate(e=>Array.from(e.children).filter(c=>!['staging-checks','video-download','recording-download','offline-progress','recording-progress'].includes(c.id)).map(c=>c.outerHTML).join(''));
  if(baseline)assert.equal(controls,baseline,'Normal reader controls must match');else baseline=controls;
  await page.fill('#text','First section.\n\nSecond section.\n\nThird section.');await page.click('#play');await page.waitForFunction(()=>__audio.some(a=>a.currentTime>.1));assert.ok(Date.now()-started<1700);
  assert.equal(await page.locator('#seek').getAttribute('max'),'0');
  assert.ok(await page.locator('#next-section').isDisabled());
  const source=await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).src);
  await page.click('#pause');await page.waitForFunction(()=>__appends===3);await page.waitForFunction(()=>__audio.some(a=>Number.isFinite(a.duration)&&a.duration>10));
  const state=await page.evaluate(()=>{const a=__audio.find(a=>a.src.startsWith('blob:'));return {source:a.src,loads:a.__loads,duration:a.duration,paused:a.paused};});
  assert.equal(state.source,source);assert.equal(state.loads,1);assert.ok(state.paused);assert.ok(Math.abs(state.duration-duration)<1/24000);
  const pausedBefore=await page.evaluate(()=>({text:document.querySelector('#text').value,time:__audio.find(a=>a.src.startsWith('blob:')).currentTime,saved:JSON.stringify(sessionStorage)}));
  await page.evaluate(async()=>{
   document.querySelector('#text').value+='\nRestored extra text.';
   window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
   window.dispatchEvent(new Event('focus'));
   document.dispatchEvent(new Event('visibilitychange'));
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  });
  assert.ok(await page.locator('#status').textContent().then(t=>t.includes('Paused')));
  assert.ok(await page.locator('#play').isEnabled());assert.equal(creates,1);assert.equal(deletes,0);
  const pausedAfter=await page.evaluate(()=>{const a=__audio.find(a=>a.src.startsWith('blob:'));return {source:a.src,time:a.currentTime,paused:a.paused,saved:JSON.stringify(sessionStorage)};});
  assert.equal(pausedAfter.source,source);assert.equal(pausedAfter.time,pausedBefore.time);assert.equal(pausedAfter.saved,pausedBefore.saved);assert.ok(pausedAfter.paused);
  await page.evaluate(async text=>{document.querySelector('#text').value=text;window.dispatchEvent(new Event('focus'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},pausedBefore.text);
  console.log(`PASS ${environment}: foreground/restoration preserves paused source, position and saved IDs`);

  assert.equal(await page.locator('#rate').getAttribute('type'),'hidden');
  assert.equal(await page.locator('#speed-preset').textContent(),'1×');
  await page.click('#speed-preset');await page.click('#speed-preset');
  assert.equal(await page.locator('#speed-preset').textContent(),'1.5×');
  assert.equal(await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).playbackRate),1.5);
  assert.equal(await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).paused),true);
  assert.equal(await page.locator('#seek').getAttribute('step'),'1');
  assert.equal(await page.locator('#seek').getAttribute('max'),'2');
  const beforeInput=await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).currentTime);
  await page.locator('#seek').evaluate(e=>{e.value=1;e.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).currentTime),beforeInput);
  await page.locator('#seek').dispatchEvent('change');
  await page.waitForFunction(target=>__audio.some(a=>Math.abs(a.currentTime-target)<.01),sections[1].start);
  assert.equal(await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).paused),true);
  assert.match(await page.locator('#seek').getAttribute('aria-valuetext'),/Section 2 of 3$/);
  assert.equal(await page.locator('#mse-fallback').isVisible(),false);
  // Force a delayed event from the old buffered source before the new file loads.
  await page.locator('#mse-fallback').evaluate(button=>{button.click();window.__audio.find(a=>a.src.startsWith('blob:'))?.dispatchEvent(new Event('pause'));});await page.waitForFunction(({target,source})=>__audio.some(a=>a.src!==source&&a.src&&(a.src.startsWith('blob:')||a.src.includes('/audio'))&&a.readyState>=1&&Math.abs(a.currentTime-target)<.01),{target:sections[1].start,source}).catch(async error=>{console.log('Completed-file seek failure',environment,await page.evaluate(()=>({status:document.querySelector('#status').textContent,audio:__audio.map(a=>({source:a.src,time:a.currentTime,duration:a.duration,ready:a.readyState,paused:a.paused,error:a.error?.code,ranges:Array.from({length:a.buffered.length},(_,i)=>[a.buffered.start(i),a.buffered.end(i)])}))})));throw error;});const completedSource=await page.evaluate(source=>__audio.find(a=>a.src!==source&&a.src&&a.readyState>=1&&a.duration>10).src,source);assert.equal(creates,1);
  for(const speed of ['2×','0.75×','1×','1.25×','1.5×']){
   await page.click('#speed-preset');assert.equal(await page.locator('#speed-preset').textContent(),speed);
  }
  await page.locator('#seek').focus();await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(src=>__audio.some(a=>a.src===src&&a.currentTime===0),completedSource);
  assert.match(await page.locator('#seek').getAttribute('aria-valuetext'),/Section 1 of 3$/);
  assert.equal(await page.evaluate(src=>__audio.find(a=>a.src===src).paused,completedSource),true);
  assert.ok(await page.locator('#speed-preset').isVisible());
  await page.screenshot({path:`work/shared-reader/${environment}-playback-controls.png`});
  assert.deepEqual(errors,[]);
  // Both readers retain server explanations instead of reducing them to a code.
  reject=true;await page.reload();await page.evaluate(()=>sessionStorage.clear());assert.equal(await page.locator('#speed-preset').textContent(),'1.5×');await page.fill('#text','First section.\n\nSecond section.\n\nThird section.');await page.click('#play');await page.waitForFunction(()=>document.body.textContent.includes('A clear server explanation.'));
  await page.goto(origin+'/?testing=1');
  if(environment==='staging'){
   await page.waitForFunction(()=>window.__stagingReader);await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
   assert.ok(await page.locator('#staging-checks').isVisible());assert.ok(await page.locator('#mse-cached').isChecked());
   await page.goto(origin);assert.equal(await page.evaluate(()=>typeof window.__stagingReader),'undefined');assert.equal(await page.locator('#staging-checks').isVisible(),false);
  }else{assert.equal(await page.locator('#staging-checks').count(),0);assert.equal(await page.evaluate(()=>typeof window.__stagingReader),'undefined');}
  // Browser speech uses the same controls without creating audio jobs.
  await page.addInitScript(()=>{
   window.__spoken=[];
   Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{name:'Fixture',voiceURI:'fixture',lang:'en-US',localService:true}],addEventListener(){},cancel(){},speak(u){window.__spoken.push(u);}}});
   window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  });
  await page.goto(origin);await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','browser');
  await page.fill('#text','First section.\n\nSecond section.\n\nThird section.');await page.click('#play');
  assert.equal(await page.locator('#seek').getAttribute('max'),'2');
  await page.click('#next-section');assert.equal(await page.locator('#seek-time').textContent(),environment==='staging'?'— / —':'2 / 3');assert.equal(await page.locator('#seek').inputValue(),'1');
  await page.click('#pause');await page.locator('#seek').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#seek-time').textContent(),environment==='staging'?'— / —':'3 / 3');assert.equal(await page.locator('#seek').inputValue(),'2');assert.ok(await page.locator('#next-section').isDisabled());
  await page.locator('#seek').evaluate(e=>{e.value=0;e.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await page.locator('#seek-time').textContent(),environment==='staging'?'— / —':'1 / 3');assert.equal(await page.locator('#seek').inputValue(),'0');
  await page.locator('#seek').dispatchEvent('pointercancel');assert.equal(await page.locator('#seek-time').textContent(),environment==='staging'?'— / —':'3 / 3');assert.equal(await page.locator('#seek').inputValue(),'2');
  await page.click('#play');await page.evaluate(()=>__spoken.at(-1).onend());await page.click('#play');
  assert.equal(await page.locator('#seek-time').textContent(),environment==='staging'?'— / —':'1 / 3');assert.equal(await page.locator('#seek').inputValue(),'0');
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:`work/shared-reader/${environment}-browser-controls-desktop.png`});
  await page.setViewportSize({width:412,height:915});await page.screenshot({path:`work/shared-reader/${environment}-browser-controls-mobile.png`});
  await page.click('#stop');assert.ok(await page.locator('#seek').isDisabled());assert.equal(await page.locator('#seek-time').textContent(),environment==='staging'?'— / —':'0 / 0');
  await page.click('#clear');assert.ok(await page.locator('#previous-section').isDisabled());assert.ok(await page.locator('#next-section').isDisabled());
  assert.deepEqual(errors,[]);
  await context.close();
  const creditContext=await browser.newContext({viewport:{width:412,height:915}}),creditPage=await creditContext.newPage();
  let balance=1,creditPosts=0;const creditJobs=new Map();
  await creditPage.addInitScript(()=>{const Original=window.Audio;window.__audio=[];window.Audio=function(...args){const a=new Original(...args);window.__audio.push(a);return a;};});
  await creditPage.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path==='/api/reader')return route.fulfill({json:{eligible:balance>0,account:{balance}}});
   if(path==='/api/readings'&&request.method()==='POST'){
    creditPosts++;const id=request.headers()['idempotency-key'],input=request.postDataJSON();
    if(!creditJobs.has(id)){balance-=input.chunks.reduce((n,t)=>n+[...t].length,0);creditJobs.set(id,true);}
    return route.fulfill({json:{id}});
   }
   if(/\/sections\/0$/.test(path))return route.fulfill({contentType:'audio/mpeg',body:bytes[0]});
   if(/^\/api\/readings\/[^/]+$/.test(path)&&request.method()==='GET')return route.fulfill({json:{state:'ready',total:1,completed:1,starts:[0],sections:[sections[0]],duration:sections[0].samples/24000}});
   return route.fulfill({json:{}});
  });
  await creditPage.goto(origin);await creditPage.locator('#voice-settings').evaluate(e=>e.open=true);await creditPage.selectOption('#engine','google');
  await creditPage.fill('#text','Hello.');await creditPage.click('#play');
  await creditPage.waitForFunction(()=>document.querySelector('#status').textContent.includes('6 credits; 1 available'));
  assert.equal(creditPosts,0);assert.equal(balance,1);assert.ok(await creditPage.locator('#play').isEnabled());
  assert.equal(await creditPage.locator('#credit-actions a').getAttribute('href'),'/api/billing');
  await creditPage.click('#credit-resume');await creditPage.waitForFunction(()=>!document.querySelector('#play').disabled);
  assert.equal(creditPosts,0);await creditPage.screenshot({path:`work/shared-reader/${environment}-credit-shortage-mobile.png`});
  await creditPage.click('#credit-browser');assert.equal(await creditPage.locator('#engine').inputValue(),'browser');assert.equal(creditPosts,0);
  await creditPage.selectOption('#engine','google');balance=6;await creditPage.click('#credit-resume');
  await creditPage.waitForFunction(()=>__audio.some(a=>a.currentTime>.1));assert.equal(creditPosts,1);assert.equal(balance,0);
  await creditPage.click('#pause');await creditPage.click('#play');assert.equal(creditPosts,1);
  await creditPage.click('#clear');await creditPage.fill('#text','Hello.');await creditPage.click('#play');
  await creditPage.waitForFunction(()=>document.querySelector('#status').textContent.includes('6 credits; 0 available'));assert.equal(creditPosts,1);
  // The recording button performs the same full-reading check even without a player job.
  await creditPage.click('#clear');await creditPage.fill('#text','Hello.');await creditPage.locator('#video-download').evaluate(e=>e.open=true);await creditPage.click('#download-video');
  await creditPage.waitForFunction(()=>document.querySelector('#video-status').textContent.includes('6 credits; 0 available'));assert.equal(creditPosts,1);assert.ok(await creditPage.locator('#credit-actions').isVisible());
  await creditContext.close();console.log(`PASS ${environment}: shortage UI, free browser choice, top-up Resume, Clear and recording preflight`);
  const cleared=await browser.newContext(),fresh=await cleared.newPage();let freshCreates=0;const freshJobs=new Map();
  await fresh.route('**/api/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path==='/api/reader')return route.fulfill({json:{eligible:true,account:{balance:900000}}});
   if(path==='/api/readings'&&request.method()==='POST'){freshCreates++;const id=request.headers()['idempotency-key'];freshJobs.set(id,request.postDataJSON().chunks.length);return route.fulfill({json:{id}});}
   if(path.startsWith('/api/readings/')){const count=freshJobs.get(path.split('/')[3])||1;return route.fulfill({json:{state:'ready',total:count,completed:count,starts:Array(count).fill(0),sections:Array.from({length:count},(_,index)=>({...sections[0],index})),duration:sections[0].samples/24000}});}
   return route.fulfill({json:{}});
  });
  await fresh.goto(origin);
  await fresh.evaluate(()=>{sessionStorage.setItem('paste2speech.video.stale',JSON.stringify([{id:'cancelled-part'}]));sessionStorage.setItem('unrelated','keep');});
  await fresh.click('#clear');await fresh.reload();
  assert.equal(await fresh.evaluate(()=>sessionStorage.getItem('paste2speech.video.stale')),null);
  assert.equal(await fresh.evaluate(()=>sessionStorage.getItem('unrelated')),'keep');
  await fresh.locator('#voice-settings').evaluate(e=>e.open=true);await fresh.selectOption('#engine','google');
  await fresh.locator('#video-split-limit').evaluate(e=>{e.value='1200';});
  await fresh.fill('#text','A'.repeat(1100)+'.\n\n'+'B'.repeat(1100)+'.');await fresh.click('#play');
  await fresh.waitForFunction(()=>Object.keys(sessionStorage).some(k=>k.startsWith('paste2speech.video.')&&JSON.parse(sessionStorage.getItem(k)).filter(r=>r.id).length===2));
  assert.equal(freshCreates,2);await cleared.close();
  console.log(`PASS ${environment}: Clear, refresh, and fresh long-reading preparation in Chrome`);

  const restored=await browser.newContext({viewport:{width:412,height:915}}),restorePage=await restored.newPage();let restoreCreates=0,restoreDeletes=0;
  await restored.addInitScript(()=>localStorage.setItem('paste2speech.settings',JSON.stringify({engine:'google',workstationVoice:'en-US-Wavenet-F'})));
  await restorePage.route('**/api/**',async route=>{
   const r=route.request();if(new URL(r.url()).pathname==='/api/readings'&&r.method()==='POST')restoreCreates++;
   if(r.method()==='DELETE')restoreDeletes++;
   await route.fulfill({json:{account:null,eligible:false,accessAllowed:false}});
  });
  await restorePage.goto(origin);assert.ok(await restorePage.locator('#play').isDisabled());
  await restorePage.evaluate(()=>sessionStorage.setItem('paste2speech.video.preserved',JSON.stringify([{id:'saved-part'}])));
  const checkRestoration=async(text,eventName)=>{
   await restorePage.evaluate(async({text,eventName})=>{
    document.querySelector('#text').value=text;
    if(eventName==='visibilitychange'){
     Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
     Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));
    }else window.dispatchEvent(eventName==='pageshow'?new PageTransitionEvent('pageshow',{persisted:false}):new Event(eventName));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   },{text,eventName});
   assert.equal(await restorePage.locator('#play').isEnabled(),!!text.trim());
   assert.equal(await restorePage.locator('#text').inputValue(),text);
   assert.equal(await restorePage.locator('#count').textContent(),text.trim()?`${text.trim().split(/\s+/).length} words`:'');
   assert.equal(await restorePage.evaluate(()=>sessionStorage.getItem('paste2speech.video.preserved')),JSON.stringify([{id:'saved-part'}]));
   assert.equal(restoreCreates,0);assert.equal(restoreDeletes,0);
  };
  await checkRestoration('Restored synthetic morning brief.','pageshow');
  await checkRestoration('Restored synthetic morning brief.','focus');
  await checkRestoration('A changed restored brief.','visibilitychange');
  await checkRestoration('','pageshow');await checkRestoration('   ','focus');
  await checkRestoration('Text restored again.','pageshow');
  assert.equal(await restorePage.locator('#status').textContent(),'Ready when you are');
  await restored.close();console.log(`PASS ${environment}: late form restoration, changed/empty text, repeated returns and signed-out readiness without speech or cancellation`);
  const unsupported=await browser.newContext();await unsupported.addInitScript(()=>{window.MediaSource=undefined;});
  const fallback=await unsupported.newPage();await fallback.route('**/api/**',r=>r.fulfill({json:{eligible:true}}));await fallback.goto(origin);await fallback.locator('#voice-settings').evaluate(e=>e.open=true);await fallback.selectOption('#engine','google');assert.equal(await fallback.locator('#playback-options').isVisible(),false);await unsupported.close();
  console.log(`PASS ${environment}: default controls, early playback, pause, speed, seek, same-job fallback, errors, testing-mode isolation, unsupported browser`);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
