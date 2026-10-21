// Isolated headless Chrome; every API is intercepted. No real synthesis or OCR.
import {chromium} from 'playwright';import{zipSync,strToU8}from'fflate';import{createServer}from'node:http';import{readFile,mkdir,writeFile}from'node:fs/promises';import assert from'node:assert/strict';import{inspectMp3}from'../cloudflare/prepared/mp3.js';import{OCR_TEMPORARY_POLICY}from'../public/cloud-choices.js';
const out=process.env.INPUT_QUEUE_OUT||'work/input-queue';await mkdir(out,{recursive:true});
const root=process.env.READER_VARIANT==='public'?'work/production-reader/site':'work/private-reader/site',server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://local').pathname.slice(1)||'index.html';res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(await readFile(root+'/'+p));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=process.env.READER_ORIGIN||`http://127.0.0.1:${server.address().port}`;
const mp3=Buffer.concat(Array(40).fill(await readFile('tests/fixtures/wavenet/en-US-Wavenet-F-03.mp3'))),info=inspectMp3(mp3),sectionDuration=info.samples/24000;
const speech=new Map(),scans=new Map(),posts=[],errors=[],external=[],checks=[];let scope='queue-owner',held=true,delayConfig=false,releaseConfig;
const wallet=()=>({walletVersion:'unified-v1',balance:1000000,held:0,debt:0,unitsPerCredit:1000}),config=()=>({durable:true,enabled:true,model:'mistral-ocr-4-1',maxBytes:50000000,maxPages:1000,unitsPerPage:2000,consentScope:scope,consentPolicy:OCR_TEMPORARY_POLICY.version,balance:wallet(),summaryPriceCredits:1});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
try{
if(process.env.READER_ORIGIN){const {execFileSync}=await import('node:child_process');const token=execFileSync('cloudflared',['access','token','--app',origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();await context.addCookies([{name:'CF_Authorization',value:token,domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true}]);}
page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.__queueAudios=[];const Original=window.Audio;window.Audio=function(...args){const audio=new Original(...args);__queueAudios.push(audio);return audio;};window.__queueAudio=()=>__queueAudios.find(a=>a.src.startsWith('blob:'))||__queueAudios.find(a=>a.currentSrc)||__queueAudios[0];window.clipboardText='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>[{types:['text/plain'],getType:async()=>new Blob([clipboardText],{type:'text/plain'})}],readText:async()=>clipboardText}});});
await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),p=u.pathname;if(u.origin!==origin){external.push(u.origin);return route.abort();}if(!p.startsWith('/api/'))return route.continue();
 if(p==='/api/reader')return route.fulfill({json:{eligible:true,accessAllowed:true,account:{...wallet(),verified:true,creditRequired:true}}});
 if(p==='/api/summary/config')return route.fulfill({json:{available:false}});
 if(p==='/api/ocr/jobs/config'){if(delayConfig)await new Promise(resolve=>releaseConfig=resolve);return route.fulfill({json:config()});}
 if(p==='/api/ocr/jobs/recent')return route.fulfill({json:{jobs:[...scans.values()].map(j=>({...j,fileName:j.name,durable:true,expires:Date.now()+86400000})),saved:[],balance:wallet()}});
 if(p==='/api/ocr/jobs/init'){const b=req.postDataJSON();scans.set(b.id,{...b,state:'awaiting-upload',pages:1});return route.fulfill({json:{id:b.id,state:'awaiting-upload'}});}
 if(p.startsWith('/api/ocr/jobs/')){const [,a,b,c,id,op]=p.split('/'),job=scans.get(id);assert.ok(job,p);if(op==='upload'){job.state='verified';const prior=[...scans.values()].find(j=>j.id!==id&&j.name===job.name&&['held','ready'].includes(j.state));return route.fulfill({json:{...(prior?{prior:{id:prior.id,state:prior.state,durable:true,recoveryAllowed:false,expires:Date.now()+86400000}}:{}),id,pages:1,priceCredits:2,units:2000,documentHash:'a'.repeat(64),wallet:wallet(),canSubmit:true,consentScope:scope,consentPolicy:OCR_TEMPORARY_POLICY.version}});}if(op==='accept'){posts.push({kind:'scan',name:job.name});job.state=held?'held':'ready';return route.fulfill({json:{...job,wallet:wallet()}});}if(op==='cancel'){job.state='canceled';return route.fulfill({json:{...job,wallet:wallet()}});}if(op==='result')return route.fulfill({json:{model:'mistral-ocr-4-1',pages:[{index:0,markdown:'Text from '+job.name}],p2s_ocr:{...wallet(),creditsUsed:2}}});}
 if(p==='/api/readings'&&req.method()==='POST'){const b=req.postDataJSON(),id=req.headers()['idempotency-key'];posts.push({kind:'speech',...b});speech.set(id,{...b,id});return route.fulfill({json:{id}});}
 if(p.startsWith('/api/readings/')){const m=p.match(/^\/api\/readings\/([^/]+)(.*)$/),job=speech.get(m[1]);assert.ok(job,p);if(req.method()==='DELETE')return route.fulfill({status:204});if(m[2].startsWith('/sections/'))return route.fulfill({contentType:'audio/mpeg',body:mp3});if(m[2]==='/audio'){const body=Buffer.concat(job.chunks.map(()=>mp3)),match=req.headers().range?.match(/^bytes=(\d+)-(\d*)$/),start=match?Number(match[1]):0,end=match?.[2]?Number(match[2]):body.length-1;return route.fulfill({status:match?206:200,contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes',...(match?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})},body:body.subarray(start,end+1)});}return route.fulfill({json:{id:job.id,state:'ready',duration:job.chunks.length*sectionDuration,total:job.chunks.length,completed:job.chunks.length,starts:job.chunks.map((_,i)=>i*sectionDuration),sections:job.chunks.map((_,i)=>({index:i,start:i*sectionDuration,samples:info.samples,bytes:info.bytes}))}});}
 return route.fulfill({json:{}});
});
const speechCount=()=>posts.filter(p=>p.kind==='speech').length;
async function paste(action,text){await page.evaluate(text=>clipboardText=text,text);if(action==='play')return page.click('#paste-play');await page.click('#paste-options');await page.click(action==='only'?'#paste':action==='next'?'#paste-next':'#paste-queue');if(action!=='only')await page.waitForFunction(text=>[...document.querySelectorAll('.queue-pending')].some(e=>e.textContent===text),text);else await page.waitForFunction(text=>document.querySelector('#text').value.includes(text),text);}
async function current(text){await page.waitForFunction(text=>(text.startsWith('Text from ')?document.querySelector('#text').value.endsWith(text):document.querySelector('#text').value===text)&&document.querySelector('#status').textContent==='Reading aloud',text);}
async function finish(){await page.waitForFunction(()=>Number.isFinite(__queueAudio().duration)&&__queueAudio().duration>0&&__queueAudio().readyState>=3);await page.evaluate(()=>{const audio=__queueAudio();audio.currentTime=audio.duration-.03;});}
async function pick(action,name){await page.waitForFunction(()=>!document.querySelector('#document-choose-file').disabled);const chosen=page.waitForEvent('filechooser');if(action!=='editor'){await page.click('#file-options');await page.click(action==='play'?'#file-play':action==='next'?'#file-next':'#file-queue');}else await page.click('#document-choose-file');await(await chosen).setFiles(typeof name==='object'?name:{name,mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,1])});await page.waitForFunction(()=>!document.querySelector('#pdf-file').disabled);}
await page.addInitScript(()=>{const synth=new EventTarget();window.__spoken=[];synth.getVoices=()=>[{name:'Fixture voice',voiceURI:'fixture-native',lang:'en-US',localService:true}];synth.cancel=()=>{};synth.speak=u=>{__spoken.push(u);queueMicrotask(()=>u.onstart?.());};Object.defineProperty(window,'speechSynthesis',{value:synth});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};});
await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('#document-choose-file').disabled);
if(await page.getByRole('button',{name:'Dismiss guide',exact:true}).isVisible())await page.getByRole('button',{name:'Dismiss guide',exact:true}).click();
const jpeg=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;canvas.getContext('2d').fillText('Synthetic page',2,20);return canvas.toDataURL('image/jpeg').split(',')[1];});
const image=name=>({name,mimeType:'image/jpeg',buffer:Buffer.from(jpeg,'base64')});
const rows=()=>page.locator('#queue-items li').allTextContents();
await pick('editor',image('first.jpeg'));
await pick('next',image('second.jpeg'));
await page.waitForFunction(()=>document.querySelectorAll('#queue-items li').length===2);
assert.equal(await page.locator('#reading-queue').isVisible(),true);assert.match(await page.locator('#queue-summary').textContent(),/Processing/);
assert.deepEqual(await page.locator('#queue-items .queue-title').allTextContents(),['first.jpeg · Processing…','second.jpeg · Processing…']);
assert.equal(await page.locator('#text').inputValue(),'');
await page.locator('#reading-queue').evaluate(e=>e.open=true);
await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'work/reading-history/image-queue-pending-desktop.png',fullPage:true});
scans.get([...scans.keys()][1]).state='ready';
await page.waitForFunction(()=>document.querySelectorAll('#queue-items .queue-title')[1]?.textContent==='second.jpeg');
assert.equal(await page.locator('#text').inputValue(),'');
assert.match((await rows())[0],/first.jpeg.*Processing/);
scans.get([...scans.keys()][0]).state='ready';
await page.waitForFunction(()=>document.querySelector('#text').value.endsWith('Text from first.jpeg'));
await page.waitForFunction(()=>document.querySelectorAll('#queue-items li').length===2&&!document.querySelector('#queue-items .queue-title').textContent.includes('Processing'));
assert.equal(speechCount(),0);assert.equal(posts.filter(p=>p.kind==='scan').length,2);
const ids=await page.locator('#queue-items li').evaluateAll(rows=>rows.map(row=>row.dataset.queueId));
await page.click('#next-reading');await page.waitForFunction(()=>document.querySelector('#text').value.endsWith('Text from second.jpeg'));
await page.click('#previous-reading');await page.waitForFunction(()=>document.querySelector('#text').value.endsWith('Text from first.jpeg'));
assert.deepEqual(await page.locator('#queue-items li').evaluateAll(rows=>rows.map(row=>row.dataset.queueId)),ids);
await page.setViewportSize({width:360,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await page.screenshot({path:'work/reading-history/image-queue-ready-mobile.png',fullPage:true});
await page.click('#clear');for(const id of ids){const row=page.locator('#queue-items li').filter({has:page.locator('[data-queue-action=Remove]')}).locator('[data-queue-action=Remove]').first();if(await row.count()){const before=await page.locator('#queue-items li').count();await row.evaluate(button=>button.click());await page.waitForFunction(before=>document.querySelectorAll('#queue-items li').length<before,before);}}await page.waitForFunction(()=>document.querySelectorAll('#queue-items li').length===0);
await pick('next',image('failed.jpeg'));
await page.waitForFunction(()=>document.querySelectorAll('#queue-items li').length===1);
assert.equal(await page.locator('#reading-queue').isVisible(),true);
[...scans.values()].find(j=>j.name==='failed.jpeg').state='failed';
await page.waitForFunction(()=>document.querySelector('.queue-title')?.textContent.includes('did not produce'));
assert.equal(await page.locator('#reading-queue').isVisible(),true);
assert.equal(posts.filter(p=>p.kind==='scan').length,3);assert.equal(speechCount(),0);assert.match(await page.locator('#queue-summary').textContent(),/Needs attention/);
await page.screenshot({path:'work/reading-history/image-queue-failed-mobile.png',fullPage:true});
for(let remaining=await page.locator('#queue-items li').count();remaining;remaining--){await page.locator('#queue-items [data-queue-action=Remove]').first().evaluate(button=>button.click());await page.waitForFunction(n=>document.querySelectorAll('#queue-items li').length<n,remaining);}
await pick('play',image('auto-first.jpeg'));await pick('next',image('auto-next.jpeg'));
[...scans.values()].find(j=>j.name==='auto-next.jpeg').state='ready';[...scans.values()].find(j=>j.name==='auto-first.jpeg').state='ready';
await page.waitForFunction(()=>document.querySelector('#text').value.endsWith('Text from auto-first.jpeg')&&document.querySelector('#status').textContent==='Reading aloud');
assert.equal(await page.locator('#queue-items li').count(),2);
await page.evaluate(()=>__spoken.at(-1).onend());await page.waitForFunction(()=>__spoken.at(-1).text.includes('auto-first.jpeg'));
await page.evaluate(()=>__spoken.at(-1).onend());await page.waitForFunction(()=>document.querySelector('#text').value.endsWith('Text from auto-next.jpeg')&&document.querySelector('#status').textContent==='Reading aloud');
assert.equal(speechCount(),0);assert.equal(posts.filter(p=>p.kind==='scan').length,5);
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
console.log(JSON.stringify({firstScanPreserved:true,queuedScanImmediatelyVisible:true,outOfOrderCompletion:true,sameLogicalIds:true,roundtrip:true,singlePendingAndFailureVisible:true,explicitOpenPlayAndNativeQueueAdvance:true,realProviderCalls:0,realApiWrites:0,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
