// Production assets with intercepted synthetic audio; never sends synthesis requests.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
const assets='work/production-reader/site';
const server=createServer(async(req,res)=>{try{const path=req.url.split('?')[0];const file=path==='/'?'index.html':path.slice(1);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(`${assets}/${file}`));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(8792,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let submitted,started;const bytes=await Promise.all(fixtures['en-US-Wavenet-F'].slice(0,3).map(p=>readFile('tests/fixtures/wavenet/'+p.file)));let duration=0;const sections=bytes.map((b,index)=>{const m=inspectMp3(b),part={index,start:duration,samples:m.samples,bytes:m.bytes};duration+=m.samples/24000;return part;});
 await page.addInitScript(()=>{const Original=window.Audio;window.__audio=[];window.Audio=function(...args){const a=new Original(...args);window.__audio.push(a);a.__loads=0;a.addEventListener('loadstart',()=>a.__loads++);return a;};window.__appends=0;const append=SourceBuffer.prototype.appendBuffer;SourceBuffer.prototype.appendBuffer=function(b){window.__appends++;return append.call(this,b);};});
 await page.route('**/api/**',async route=>{const r=route.request(),p=new URL(r.url()).pathname;let data={};
 if(p==='/api/reader')data={eligible:true,account:{balance:62100}};
 else if(p==='/api/readings'&&r.method()==='POST'){submitted=r.postDataJSON();started=Date.now();assert.equal(submitted.delivery,'mse');assert.equal(submitted.mseOptions,undefined);assert.equal(submitted.chunks.length,3);data={id:'synthetic'};}
 else if(p.endsWith('/sections/0')||p.endsWith('/sections/1')||p.endsWith('/sections/2'))return route.fulfill({contentType:'audio/mpeg',body:bytes[Number(p.at(-1))]});
 else if(p==='/api/readings/synthetic'){const done=Date.now()-started>1700;data={id:'synthetic',state:done?'ready':'preparing',starts:sections.slice(0,done?3:1).map(s=>s.start),duration:done?duration:sections[1].start,completed:done?3:1,total:3,sections:sections.slice(0,done?3:1),delivery:'mse'};}
 await route.fulfill({json:data});});
 await page.goto('http://127.0.0.1:8792');await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');assert.equal(await page.locator('#mse-delivery').inputValue(),'mse');assert.equal(await page.locator('#staging-checks').count(),0);assert.equal(await page.evaluate(()=>typeof window.__stagingReader),'undefined');
 await page.fill('#text','First section.\n\nSecond section.\n\nThird section.');await page.click('#play');await page.waitForFunction(()=>__audio.some(a=>a.currentTime>.1));assert.ok(Date.now()-started<1700);const src=await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).src);await page.click('#pause');await page.waitForFunction(()=>__appends===3);await page.waitForFunction(()=>__audio.some(a=>Number.isFinite(a.duration)&&a.duration>10));
 const state=await page.evaluate(()=>{const a=__audio.find(a=>a.src.startsWith('blob:'));return {src:a.src,loads:a.__loads,duration:a.duration,paused:a.paused,appends:__appends};});assert.equal(state.src,src);assert.equal(state.loads,1);assert.equal(state.appends,3);assert.ok(state.paused);assert.ok(Math.abs(state.duration-duration)<1/24000);assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,simulated:true,...state,src:'one unchanged MediaSource',duration}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
