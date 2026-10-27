// Real built/hosted staging UI; synthetic OCR/speech APIs and fixture MP3 only.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {OCR_TEMPORARY_POLICY} from '../public/cloud-choices.js';
import {inspectMp3} from '../cloudflare/prepared/mp3.js';
const hosted=process.env.READER_ORIGIN,root='work/private-reader/site',out='work/processing-indicator-2026-10-12';
await mkdir(out,{recursive:true});
const server=hosted?null:createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://local').pathname.slice(1)||'index.html';res.setHeader('Content-Type',/\.m?js$/.test(path)?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(root+'/'+path));}catch{res.writeHead(404).end();}
});
if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=hosted||'http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const context=await browser.newContext({viewport:{width:1100,height:900}});
if(hosted){const token=execFileSync('cloudflared',['access','token','--app',origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();await context.addCookies([{name:'CF_Authorization',value:token,domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true}]);}
const page=await context.newPage(),errors=[],external=[],jobs=new Map(),gates=new Map();
let last,readingId,acceptMode='held',rejectRecent=false,apiWrites=0;
const arm=key=>{let release;const promise=new Promise(r=>release=r);gates.set(key,{entered:false,resolve:release,promise});};
const waitGate=async key=>{const until=Date.now()+10000;while(!gates.get(key)?.entered){if(Date.now()>until)throw Error('Synthetic gate was not reached: '+key);await new Promise(r=>setTimeout(r,10));}};
const release=key=>{gates.get(key)?.resolve();gates.delete(key);};
const hold=async key=>{const gate=gates.get(key);if(gate){gate.entered=true;await gate.promise;}};
const wallet={walletVersion:'unified-v1',balance:1000000,held:0,debt:0,unitsPerCredit:1000};
const config={durable:true,enabled:true,model:'mistral-ocr-4-1',maxBytes:50000000,maxPages:1000,unitsPerPage:2000,consentScope:'synthetic-owner',consentPolicy:OCR_TEMPORARY_POLICY.version,balance:wallet};
const bytes=await readFile('tests/fixtures/wavenet/en-US-Wavenet-F-00.mp3'),mp3=inspectMp3(bytes),duration=mp3.samples/24000;
const raw={model:config.model,pages:[{index:0,markdown:'Synthetic scanned text.',footer:'Synthetic footer deliberately omitted.'}],p2s_ocr:{...wallet,creditsUsed:0,cached:true}};
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 window.spoken=[];window.audioElements=[];window.instantVoice=false;
 Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{name:'Test device voice',voiceURI:'fixture',lang:'en-US',localService:true}],addEventListener(){},cancel(){},speak(u){spoken.push(u);if(instantVoice)u.onstart?.();}}});
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 const AudioOriginal=window.Audio;window.Audio=function(...args){const a=new AudioOriginal(...args);const play=a.play.bind(a);a.play=()=>window.holdMediaStart?new Promise((resolve,reject)=>{window.releaseMediaStart=()=>play().then(resolve,reject);}):play();audioElements.push(a);return a;};
});
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 if(url.origin!==origin){external.push(url.origin);return route.abort();}
 if(!path.startsWith('/api/'))return route.continue();
 if(req.method()!=='GET')apiWrites++;
 if(path==='/api/reader')return route.fulfill({json:{eligible:true,accessAllowed:true,account:{...wallet,verified:true,creditRequired:true},voices:['en-US-Wavenet-F']}});
 if(path==='/api/translation/config')return route.fulfill({json:{enabled:false,scope:'synthetic-owner',priceCreditsPer1000:null,detail:'Translation is not exercised by this scan fixture.'}});if(path==='/api/events'||path==='/api/summary/config'||path==='/api/billing/session')return route.fulfill({json:{available:false}});
 if(path==='/api/ocr/jobs/config')return route.fulfill({json:config});
 if(path==='/api/ocr/jobs/recent'){
  const snapshot=[...jobs.values()].map(j=>({...j}));await hold('recent');
  return route.fulfill(rejectRecent?{status:503,json:{detail:'Synthetic connection failed. Check Recent scans.'}}:{json:{jobs:snapshot,balance:wallet}});
 }
 if(path==='/api/ocr/jobs/init'){const p=req.postDataJSON();last=p.id;jobs.set(last,{id:last,fileName:p.name,state:'awaiting-upload',pages:1,durable:true,expires:Date.now()+86400000});return route.fulfill({json:{id:last}});}
 const parts=path.split('/'),job=jobs.get(parts[4]);
 if(job){
  const op=parts[5];
  if(op==='upload'){await hold('upload');job.state='verified';return route.fulfill({json:{id:job.id,pages:1,priceCredits:2,units:2000,documentHash:'a'.repeat(64),wallet,canSubmit:true,consentScope:config.consentScope,consentPolicy:config.consentPolicy}});}
  if(op==='accept'){await hold('accept');job.state=acceptMode;job.creditsUsed=acceptMode==='ready'?2:0;return route.fulfill({status:202,json:{id:job.id,state:job.state,wallet}});}
  if(op==='result'){await hold('result');return route.fulfill({json:raw});}
  if(op==='cancel'){job.state='canceled';job.creditsReleased=2;return route.fulfill({json:{state:'canceled',wallet}});}
 }
 if(path==='/api/readings'&&req.method()==='POST'){readingId=req.headers()['idempotency-key'];await hold('audio-start');return route.fulfill({json:{id:readingId}});}
 if(path==='/api/readings/'+readingId&&req.method()==='GET')return route.fulfill({json:{id:readingId,state:'ready',starts:[0],duration,completed:1,total:1,sections:[{index:0,start:0,samples:mp3.samples,bytes:mp3.bytes}]}});
 if(path.match(/\/sections\/0$/))return route.fulfill({contentType:'audio/mpeg',body:bytes});
 if(req.method()==='DELETE')return route.fulfill({status:204});
 throw Error('Unexpected synthetic API '+req.method()+' '+path);
});
const hidden=()=>page.waitForFunction(()=>document.getElementById('processing-indicator').hidden);
const notice=async(kind,message)=>{await page.locator('#processing-'+kind).waitFor({state:'visible'});if(message)assert.match(await page.locator('#processing-'+kind).textContent(),message);};
const openScans=async()=>{};
const refresh=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(150);};
let imageIndex=0;
const choose=async()=>{await page.locator('#pdf-file').setInputFiles({name:'synthetic-'+(++imageIndex)+'.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,imageIndex])});await page.waitForFunction(()=>!document.getElementById('pdf-file').disabled);};
const quote=async()=>{await choose();await page.click('#document-ocr');await page.waitForFunction(()=>!document.getElementById('pdf-file').disabled);};
const submit=async()=>{await page.click('#document-ocr');await page.waitForFunction(()=>!document.getElementById('pdf-file').disabled);};
try{
 await page.goto(origin);await page.evaluate(()=>{window.noticeShows=0;const panel=document.getElementById('processing-indicator');new MutationObserver(()=>{if(!panel.hidden)noticeShows++;}).observe(panel,{attributes:true,attributeFilter:['hidden']});});await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','browser');await page.selectOption('#voice','fixture');await page.fill('#text','The original text stays here.');
 await page.click('#play');await notice('audio',/Starting your device voice/);assert.equal(await page.locator('#status').textContent(),'Starting your device voice…');
 assert.equal(await page.locator('#pause').isEnabled(),true);assert.equal(await page.locator('#processing-indicator').evaluate(e=>getComputedStyle(e).pointerEvents),'auto');assert.equal(await page.locator('#processing-indicator').getAttribute('aria-live'),'polite');assert.equal(await page.locator('#processing-indicator button').count(),0);
 await page.screenshot({path:out+'/device-start-'+(hosted?'hosted':'built')+'.png'});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const rect=await page.locator('#processing-indicator').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width);}
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.processing-spinner').evaluate(e=>getComputedStyle(e).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
 await page.click('#pause');await hidden();await page.evaluate(()=>spoken[0].onstart());assert.match(await page.locator('#status').textContent(),/Paused/);
 await page.click('#play');await notice('audio');await page.evaluate(()=>spoken.at(-1).onstart());await hidden();assert.equal(await page.locator('#status').textContent(),'Reading aloud');
 await page.click('#stop');await page.evaluate(()=>{instantVoice=true;noticeShows=0;});await page.click('#play');await page.waitForTimeout(250);await hidden();assert.equal(await page.evaluate(()=>noticeShows),0);await page.click('#stop');await page.evaluate(()=>instantVoice=false);
 await page.click('#play');await notice('audio');await page.evaluate(()=>spoken.at(-1).onerror({error:'synthesis-failed'}));await hidden();assert.match(await page.locator('#status').textContent(),/synthesis-failed/);
 await page.click('#play');await notice('audio');await page.click('#edit-mode');await page.fill('#text','Edits during startup.');await hidden();assert.equal(await page.locator('#text').inputValue(),'Edits during startup.');await page.evaluate(()=>spoken.at(-1).onstart());await hidden();
 // Cloud startup uses the real player and MP3, with a held synthetic job response.
 await page.click('#play');await notice('audio');await page.selectOption('#engine','google');await hidden();await page.evaluate(()=>spoken.at(-1).onstart());await hidden();await page.click('#edit-mode');await page.fill('#text','One audio section.');arm('audio-start');await page.click('#play');await waitGate('audio-start');await notice('audio',/Preparing audio/);release('audio-start');await page.waitForFunction(()=>document.getElementById('status').textContent==='Reading aloud');await hidden();
 await page.evaluate(()=>{const a=audioElements.find(a=>a.src.startsWith('blob:'));a.dispatchEvent(new Event('waiting'));});await notice('audio',/Waiting for audio/);
 await page.evaluate(()=>{const a=audioElements.find(a=>a.src.startsWith('blob:'));a.dispatchEvent(new Event('playing'));window.dispatchEvent(new Event('offline'));});await hidden();await page.click('#pause');await hidden();await page.evaluate(()=>holdMediaStart=true);await page.click('#play');await notice('audio',/Starting audio/);assert.equal(await page.locator('#pause').isEnabled(),true);await page.evaluate(()=>{holdMediaStart=false;releaseMediaStart();});await page.waitForFunction(()=>document.getElementById('status').textContent==='Reading aloud');await hidden();await page.click('#stop');
 // Upload/cost, acceptance and server waiting have distinct temporary phases.
 await page.click('#edit-mode');await page.fill('#text','Preserve my document.');await choose();arm('upload');await page.click('#document-ocr');await waitGate('upload');await notice('ocr',/Uploading document/);release('upload');await page.waitForFunction(()=>!document.getElementById('pdf-file').disabled);await hidden();
 arm('accept');await page.click('#document-ocr');await waitGate('accept');await notice('ocr',/Submitting scan/);release('accept');await page.waitForFunction(()=>!document.getElementById('pdf-file').disabled);await notice('ocr',/Scanning document/);assert.equal(await page.locator('.pdf-import').count(),0);assert.ok(await page.locator('#document-context').isVisible());
 await page.click('#edit-mode');assert.equal(await page.locator('#text').evaluate(e=>e.readOnly),false);await page.fill('#text','Edits while the scan runs.');assert.equal(await page.locator('#text').inputValue(),'Edits while the scan runs.');
 await page.selectOption('#engine','browser');await page.click('#play');await notice('audio');assert.equal(await page.locator('.processing-indicator-row').count(),2);await page.click('#pause');assert.equal(await page.locator('#processing-ocr').isVisible(),true);await page.click('#stop');
 await page.screenshot({path:out+'/scan-wait-'+(hosted?'hosted':'built')+'.png'});
 jobs.get(last).state='ready';jobs.get(last).creditsUsed=2;await refresh();await hidden();assert.equal(await page.locator('#text').inputValue(),'Edits while the scan runs.');assert.equal(await page.locator('#document-load-result').evaluate(e=>e.hidden),false);
 arm('result');await page.locator('#document-load-result').click();await waitGate('result');await notice('ocr',/Loading scan/);await page.click('#clear');await hidden();await page.fill('#text','New text after Clear.');release('result');await page.waitForTimeout(300);await hidden();assert.equal(await page.locator('#text').inputValue(),'New text after Clear.');
 await quote();await submit();jobs.get(last).state='ready';await refresh();await page.waitForFunction(()=>document.getElementById('text').value.includes('Synthetic scanned text'));await hidden();assert.doesNotMatch(await page.locator('#text').inputValue(),/Synthetic footer/);
 // Failures and cancellation retire the wait; a lost poll can recover on refresh.
 await quote();await submit();await notice('ocr');rejectRecent=true;await refresh();await page.locator('#processing-scan-outcome').waitFor({state:'visible'});assert.match(await page.locator('#pdf-status').textContent(),/Synthetic connection failed/);rejectRecent=false;await refresh();await notice('ocr');jobs.get(last).state='uncertain';jobs.get(last).creditsReleased=2;await refresh();assert.match(await page.locator('#processing-scan-outcome').textContent(),/Scan did not finish/);
 await page.click('#clear');await quote();await submit();await notice('ocr');await openScans();await page.click('#cancel-pdf');await page.locator('#processing-scan-outcome').waitFor({state:'visible'});
 // A stale acceptance/recent response cannot revive an indicator after Clear.
 await page.click('#clear');await quote();arm('accept');await page.click('#document-ocr');await waitGate('accept');await notice('ocr');await page.click('#clear');await page.fill('#text','Final preserved text.');release('accept');await page.waitForTimeout(300);await hidden();assert.equal(await page.locator('#text').inputValue(),'Final preserved text.');
 await quote();await submit();arm('recent');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitGate('recent');await page.click('#clear');release('recent');await page.waitForTimeout(300);await hidden();
 // Instant OCR completion should leave no persistent indicator.
 acceptMode='ready';await quote();await page.evaluate(()=>noticeShows=0);await submit();await page.waitForFunction(()=>document.getElementById('text').value.includes('Synthetic scanned text'));await page.waitForTimeout(250);await hidden();assert.equal(await page.evaluate(()=>noticeShows),0);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const served=await page.evaluate(async()=>(await fetch('/release.json')).json()),commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(hosted)assert.equal(served.commit,commit);
 await writeFile(out+'/verification-'+(hosted?'hosted':'built')+'.json',JSON.stringify({commit,servedCommit:served.commit,hosted:!!hosted,inFlowStatus:true,actualDeviceStartTracked:true,cloudStartupAndBufferWait:true,noNoticeDuringPlayingOrPause:true,ocrUploadAcceptServerLoad:true,editsPreserved:true,simultaneousAudioAndOcr:true,failureAndCancelDismiss:true,staleAcceptanceAndRecentIgnored:true,clearDuringLoadingPreservesNewText:true,footerStillOmitted:true,reducedMotion:true,mobileWidths:[320,390],mockApiWrites:apiWrites,realProviderCalls:0,realPayments:0,pageErrors:errors,externalRequests:external},null,2)+'\n');
 console.log('PASS '+(hosted?'hosted':'built')+' staging processing indicators: actual voice start, cloud audio/buffering, OCR upload/accept/wait/load, usable controls/editor, concurrent waits, failure/cancel/Clear/stale dismissal, fast completion, mobile/reduced motion. Synthetic APIs only.');
}catch(error){console.log(JSON.stringify({status:await page.locator('#status').textContent(),ocr:await page.locator('#pdf-status').textContent(),indicator:await page.locator('#processing-indicator').textContent(),errors}));throw error;}
finally{for(const gate of gates.values())gate.resolve();await context.close();await browser.close();if(server)await new Promise(r=>server.close(r));}
