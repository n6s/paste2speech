// The same browser checks exercise both built readers. All API requests are
// intercepted; synthetic fixtures never call a provider or alter an account.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
const sites={staging:'work/private-reader/site',production:'work/production-reader/site'};
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
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let started,creates=0,reject=false;
  await page.addInitScript(()=>{const Original=window.Audio;window.__audio=[];window.Audio=function(...args){const a=new Original(...args);window.__audio.push(a);a.__loads=0;a.addEventListener('loadstart',()=>a.__loads++);return a;};window.__appends=0;const append=SourceBuffer.prototype.appendBuffer;SourceBuffer.prototype.appendBuffer=function(b){window.__appends++;return append.call(this,b);};});
  await page.route('**/api/**',async route=>{
   const r=route.request(),p=new URL(r.url()).pathname;let data={};
   if(p==='/api/reader')data={eligible:true,account:{balance:62100}};
   else if(p==='/api/readings'&&r.method()==='POST'){
    if(reject)return route.fulfill({status:403,json:{detail:'A clear server explanation.'}});
    const submitted=r.postDataJSON();started=Date.now();creates++;assert.equal(submitted.delivery,'mse');assert.equal(submitted.mseOptions,undefined);assert.equal(submitted.chunks.length,3);data={id:'synthetic'};
   }else if(/\/sections\/[0-2]$/.test(p))return route.fulfill({contentType:'audio/mpeg',body:bytes[Number(p.at(-1))]});
   else if(p.endsWith('/audio')){
    const audio=Buffer.concat(bytes),range=r.headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start=range?Number(range[1]):0,end=range&&range[2]?Number(range[2]):audio.length-1;
    return route.fulfill({status:range?206:200,contentType:'audio/mpeg',headers:{'Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})},body:audio.subarray(start,end+1)});
   }
   else if(p==='/api/readings/synthetic'){
    const done=Date.now()-started>1700;data={id:'synthetic',state:done?'ready':'preparing',starts:sections.slice(0,done?3:1).map(s=>s.start),duration:done?duration:sections[1].start,completed:done?3:1,total:3,sections:sections.slice(0,done?3:1),delivery:'mse'};
   }
   await route.fulfill({json:data});
  });
  await page.goto(origin);await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
  assert.equal(await page.locator('#mse-delivery').inputValue(),'mse');
  assert.equal(await page.locator('#playback-options').evaluate(e=>e.open),false);
  assert.equal(await page.locator('#mse-delivery').isVisible(),false);
  assert.equal(await page.evaluate(()=>typeof window.__stagingReader),'undefined');
  assert.equal(await page.locator('#staging-checks').isVisible(),false);
  assert.equal(await page.getByText('Download recording',{exact:true}).count(),1);
  if(environment==='staging')assert.equal(await page.locator('#recording-controls > #video-download').count(),1);
  const controls=await page.locator('#recording-controls').evaluate(e=>Array.from(e.children).filter(c=>!['staging-checks','video-download','recording-download'].includes(c.id)).map(c=>c.outerHTML).join(''));
  if(baseline)assert.equal(controls,baseline,'Normal reader controls must match');else baseline=controls;
  await page.fill('#text','First section.\n\nSecond section.\n\nThird section.');await page.click('#play');await page.waitForFunction(()=>__audio.some(a=>a.currentTime>.1));assert.ok(Date.now()-started<1700);
  const source=await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).src);
  await page.click('#pause');await page.waitForFunction(()=>__appends===3);await page.waitForFunction(()=>__audio.some(a=>Number.isFinite(a.duration)&&a.duration>10));
  const state=await page.evaluate(()=>{const a=__audio.find(a=>a.src.startsWith('blob:'));return {source:a.src,loads:a.__loads,duration:a.duration,paused:a.paused};});
  assert.equal(state.source,source);assert.equal(state.loads,1);assert.ok(state.paused);assert.ok(Math.abs(state.duration-duration)<1/24000);
  await page.locator('#rate').fill('1.5');await page.locator('#rate').dispatchEvent('input');assert.equal(await page.evaluate(()=>__audio.find(a=>a.src.startsWith('blob:')).playbackRate),1.5);
  await page.locator('#seek').evaluate(e=>{e.value=8;e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>__audio.some(a=>a.currentTime>=8));
  assert.equal(await page.locator('#mse-fallback').isVisible(),false);
  await page.locator('#playback-options summary').click();await page.click('#mse-fallback');await page.waitForFunction(()=>__audio.some(a=>a.src.includes('/audio')&&a.readyState>=1&&a.currentTime>=7.99));assert.equal(creates,1);
  assert.deepEqual(errors,[]);
  // Both readers retain server explanations instead of reducing them to a code.
  reject=true;await page.reload();await page.fill('#text','First section.\n\nSecond section.\n\nThird section.');await page.click('#play');await page.waitForFunction(()=>document.body.textContent.includes('A clear server explanation.'));
  await page.goto(origin+'/?testing=1');
  if(environment==='staging'){
   await page.waitForFunction(()=>window.__stagingReader);await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.selectOption('#engine','google');
   assert.ok(await page.locator('#staging-checks').isVisible());assert.ok(await page.locator('#mse-cached').isChecked());
   await page.goto(origin);assert.equal(await page.evaluate(()=>typeof window.__stagingReader),'undefined');assert.equal(await page.locator('#staging-checks').isVisible(),false);
  }else{assert.equal(await page.locator('#staging-checks').count(),0);assert.equal(await page.evaluate(()=>typeof window.__stagingReader),'undefined');}
  await context.close();
  const unsupported=await browser.newContext();await unsupported.addInitScript(()=>{window.MediaSource=undefined;});
  const fallback=await unsupported.newPage();await fallback.route('**/api/**',r=>r.fulfill({json:{eligible:true}}));await fallback.goto(origin);await fallback.locator('#voice-settings').evaluate(e=>e.open=true);await fallback.selectOption('#engine','google');assert.equal(await fallback.locator('#mse-delivery').inputValue(),'complete');assert.ok(await fallback.locator('#mse-delivery option[value=mse]').evaluate(e=>e.disabled));await unsupported.close();
  console.log(`PASS ${environment}: default controls, early playback, pause, speed, seek, same-job fallback, errors, testing-mode isolation, unsupported browser`);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
