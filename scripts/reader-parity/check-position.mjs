import {chromium} from 'playwright';
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
const root=process.cwd();const bytes=await Promise.all([0,1,2].map(i=>readFile(`${root}/tests/fixtures/wavenet/en-US-Wavenet-F-0${i}.mp3`)));let duration=0;const sections=bytes.map((b,index)=>{const m=inspectMp3(b);const s={index,start:duration,samples:m.samples,bytes:b.length};duration+=m.samples/24000;return s;});
let assets='work/private-reader/site';const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(`${root}/${assets}/${path==='/'?'index.html':path.slice(1)}`));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{for(const env of ['staging','public','public-full']){
 assets=env==='staging'?'work/private-reader/site':'work/production-reader/site';const c=await browser.newContext({viewport:{width:412,height:915}}),page=await c.newPage();let creates=0,debit=0,deletes=0,audioGets=0,missing=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));const jobs=new Map();
 if(env==='public-full')await c.addInitScript(()=>{window.MediaSource=undefined;});
 await c.addInitScript(()=>{localStorage.setItem('paste2speech.settings',JSON.stringify({engine:'google',workstationVoice:'en-US-Wavenet-F'}));const Original=window.Audio;window.__audio=[];window.Audio=function(...a){const x=new Original(...a);__audio.push(x);return x;};});
 await page.route('**/api/**',async route=>{const r=route.request(),p=new URL(r.url()).pathname;
 if(r.method()==='DELETE'){deletes++;return route.fulfill({status:204});}
 if(p==='/api/reader')return route.fulfill({json:{account:{balance:1000000-debit},eligible:true,accessAllowed:true}});
 if(p==='/api/readings'&&r.method()==='POST'){creates++;const id=r.headers()['idempotency-key'];if(!jobs.has(id)){debit+=r.postDataJSON().chunks.reduce((n,t)=>n+[...t].length,0);jobs.set(id,true);}return route.fulfill({json:{id}});}
 if(p.endsWith('/audio')){
  audioGets++;const audio=Buffer.concat(bytes),range=r.headers().range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):audio.length-1;
  return route.fulfill({status:range?206:200,contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})},body:audio.subarray(start,end+1)});
 }
 if(/\/sections\/[0-2]$/.test(p)){audioGets++;return route.fulfill({contentType:'audio/mpeg',body:bytes[Number(p.at(-1))]});}
 if(p.startsWith('/api/readings/'))return missing?route.fulfill({status:404,json:{}}):route.fulfill({json:{state:'ready',completed:3,total:3,sections,starts:sections.map(s=>s.start),duration}});
 return route.fulfill({json:{}});});
 const text='First section.\n\nSecond section.\n\nThird section.';
 const time=()=>page.evaluate(()=>__audio.find(a=>(a.src.startsWith('blob:')||a.src.includes('/api/readings/')))?.currentTime);
 const reload=async()=>{await page.reload();await page.locator('#text').fill(text);await page.waitForFunction(()=>document.querySelector('#play').textContent.includes('Resume'));};
 await page.goto(origin);await page.locator('#text').fill(text);await page.click('#play');await page.waitForFunction(()=>__audio.some(a=>a.currentTime>.1));await page.waitForFunction(()=>__audio.some(a=>a.duration>10));
 await page.evaluate(t=>{__audio.find(a=>(a.src.startsWith('blob:')||a.src.includes('/api/readings/'))).currentTime=t;},sections[1].start+.65);await page.waitForTimeout(150);await page.click('#pause');
 const paused=await time(),paid={creates,debit},saved=await page.evaluate(()=>JSON.stringify(sessionStorage));assert.ok(paused>sections[1].start);
 await reload();assert.equal(creates,paid.creates);assert.equal(debit,paid.debit);assert.equal(await time(),undefined);
 await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await page.waitForTimeout(80);assert.equal(creates,paid.creates);
 await page.click('#play');await page.waitForFunction(t=>__audio.some(a=>a.currentTime>=t-.05),paused);await page.click('#pause');assert.ok(Math.abs((await time())-paused)<.6);assert.equal(creates,paid.creates);assert.equal(debit,paid.debit);assert.equal(deletes,0);
 const second=await time();await reload();await page.click('#play');await page.waitForFunction(t=>__audio.some(a=>a.currentTime>=t-.05),second);await page.click('#pause');assert.equal(creates,paid.creates);assert.equal(debit,paid.debit);
 // Identity changes do not offer the old cursor; returning to it does.
 await reload();await page.locator('#text').fill('Changed reading.');await page.waitForTimeout(80);assert.equal(await page.locator('#play').textContent(),'▶ Play');await page.locator('#text').fill(text);await page.waitForFunction(()=>document.querySelector('#play').textContent.includes('Resume'));

 await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#voice','en-US-Wavenet-D');await page.waitForTimeout(80);assert.equal(await page.locator('#play').textContent(),'▶ Play');await page.selectOption('#voice','en-US-Wavenet-F');await page.waitForFunction(()=>document.querySelector('#play').textContent.includes('Resume'));
 await page.locator('#video-split-limit').evaluate(e=>{e.value='100';e.dispatchEvent(new Event('change'));});await page.waitForTimeout(80);assert.equal(await page.locator('#play').textContent(),'▶ Resume');
 // For these short sections, changing a ceiling without changing actual parts keeps the identity.
 await page.locator('#video-split-limit').evaluate(e=>{e.value='20000';e.dispatchEvent(new Event('change'));});
 // Missing paid audio fails closed, retaining IDs and avoiding synthesis.
 missing=true;await page.click('#play');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Cannot check'));assert.equal(creates,paid.creates);assert.equal(debit,paid.debit);missing=false;
 await reload();await page.click('#stop');assert.equal(await page.locator('#play').textContent(),'▶ Play');assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('paste2speech.position.')).length),0);assert.equal(deletes,0);
 await page.click('#play');await page.waitForFunction(()=>__audio.some(a=>a.currentTime>.1));assert.ok((await time())<sections[1].start);assert.equal(creates,paid.creates);await page.click('#pause');

 // Completion forgets a cursor. Resume never auto-plays during a plain reload.
 await page.waitForFunction(()=>__audio.some(a=>Number.isFinite(a.duration)&&a.duration>10));
 await page.evaluate(()=>__audio.find(a=>(a.src.startsWith('blob:')||a.src.includes('/api/readings/'))).dispatchEvent(new Event('ended')));assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('paste2speech.position.')).length),0);
 await page.click('#play');await page.waitForFunction(()=>__audio.some(a=>!a.paused));await page.click('#pause');await reload();
 // Losing paid references while retaining the cursor must not silently buy replacements.
 await page.evaluate(()=>{for(const k of Object.keys(sessionStorage))if(k.startsWith('paste2speech.video.'))sessionStorage.removeItem(k);});
 await page.click('#play');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('references are unavailable'));assert.equal(creates,paid.creates);assert.equal(debit,paid.debit);
 await reload();await page.click('#clear');assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('paste2speech.position.')||k.startsWith('paste2speech.video.')).length),0);assert.ok(await page.locator('#play').isDisabled());assert.deepEqual(errors,[]);
 console.log(JSON.stringify({environment:env,restoredSection:1,restoredOffset:paused-sections[1].start,paidCreates:creates,additionalDebitAfterReload:debit-paid.debit,audioGets,checks:'explicit resume; repeated reload; changed text; missing audio; Stop resets position without cancelling saved audio; Clear clears IDs and cursor'}));await c.close();
}}finally{await browser.close();server.close();}
