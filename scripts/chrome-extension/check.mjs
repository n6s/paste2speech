// Install the actual unpacked extension into an isolated Chrome profile. All
// reader HTTP traffic is fulfilled locally; no speech providers or accounts run.
import {chromium} from 'playwright';
import {readFile, mkdtemp, rm, cp, appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
const environment=process.argv.includes('--staging')?'staging':'production';
const origin=environment==='staging'?'https://staging.pastetospeech.com':'https://pastetospeech.com';
const site=environment==='staging'?'work/private-reader/site':'work/production-reader/site';
const profile=await mkdtemp(tmpdir()+'/pastetospeech-extension-');
const extension=profile+'/extension';
await cp(resolve('dist/chrome-extension/'+environment),extension,{recursive:true});
// Test-only entry point calls the exact context-menu handler; never packaged.
await appendFile(extension+'/background.js','\nglobalThis.__readSelection = readSelection;\n');
// Chrome's extension-created initial navigation can precede Playwright routing.
// Resolve the real test hostname to a local TLS server so it cannot hit live data.
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',profile+'/key.pem','-out',profile+'/cert.pem','-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
const server=createServer({key:await readFile(profile+'/key.pem'),cert:await readFile(profile+'/cert.pem')},async(req,res)=>{
  try {
    const path=new URL(req.url,origin).pathname;
    if(path.startsWith('/api/')){res.writeHead(503).end();return;}
    const file=path==='/'?'index.html':path.slice(1);
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(site+'/'+file));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const mapping=`MAP ${new URL(origin).hostname} 127.0.0.1:${server.address().port}`;
const context=await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/google-chrome',headless:true,ignoreHTTPSErrors:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-proxy-server',`--host-resolver-rules=${mapping}`]});
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
let creates=0;const jobs=new Map();
const bytes=await readFile('tests/fixtures/wavenet/en-US-Wavenet-F-00.mp3'),mp3=inspectMp3(bytes);
try {
  await context.addInitScript(origin=>{
    if(location.origin===origin&&!localStorage.getItem('paste2speech.settings'))localStorage.setItem('paste2speech.settings',JSON.stringify({engine:'google',workstationVoice:'en-GB-Wavenet-D',rate:1.5}));
  },origin);
  await context.route(origin+'/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path.startsWith('/api/')){
      if(path==='/api/reader')return route.fulfill({json:{eligible:true,account:{balance:100000}}});
      if(path==='/api/readings'&&req.method()==='POST'){
        const input=req.postDataJSON(),id=req.headers()['idempotency-key']||'job-'+creates;
        creates++;jobs.set(id,input);return route.fulfill({json:{id}});
      }
      if(/\/sections\/\d+$/.test(path))return route.fulfill({contentType:'audio/mpeg',body:bytes});
      if(req.method()==='DELETE')return route.fulfill({json:{}});
      const id=path.match(/^\/api\/readings\/([^/]+)$/)?.[1];
      if(id){const n=jobs.get(id)?.chunks.length||1;return route.fulfill({json:{id,state:'ready',starts:Array.from({length:n},(_,i)=>i*mp3.samples/24000),duration:n*mp3.samples/24000,completed:n,total:n,delivery:'mse',sections:Array.from({length:n},(_,index)=>({index,start:index*mp3.samples/24000,samples:mp3.samples,bytes:bytes.length}))}});}
      return route.fulfill({json:{}});
    }
    try{const file=path==='/'?'index.html':path.slice(1);return route.fulfill({body:await readFile(site+'/'+file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}catch{return route.fulfill({status:404,body:'not found'});}
  });
  const cdp=await context.browser().newBrowserCDPSession();
  const workerPromise=context.waitForEvent('serviceworker');
  workerPromise.catch(()=>{});
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:extension});
  let worker=context.serviceWorkers().find(w=>w.url().includes(id))||await workerPromise;
  const send=text=>worker.evaluate(text=>globalThis.__readSelection(text),text);
  const state=()=>worker.evaluate(async()=>(await chrome.storage.session.get('handoff')).handoff);
  const firstPage=context.waitForEvent('page');firstPage.catch(()=>{});
  await send('First selection.');
  const page=await firstPage;
  await page.waitForURL(origin+'/');
  await page.waitForFunction(()=>document.getElementById('text')?.value==='First selection.');
  await page.waitForFunction(()=>/Press Play to start|Reading aloud/.test(document.getElementById('status').textContent));
  const initial=await page.locator('#status').textContent();
  console.log(environment+' fresh Chrome autoplay:',initial);
  assert.equal(await page.locator('#rate').inputValue(),'1.5');assert.equal(await page.locator('#voice').inputValue(),'en-GB-Wavenet-D');
  assert.equal(creates,1);assert.equal(jobs.values().next().value.voice,'en-GB-Wavenet-D');
  if(initial==='Press Play to start')await page.click('#play');
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Reading aloud');
  assert.equal(creates,1,'Manual play must reuse audio');
  await page.click('#pause');await page.click('#speed-preset');assert.equal(await page.locator('#rate').inputValue(),'2');
  await page.click('#play');await page.waitForFunction(()=>document.getElementById('status').textContent==='Reading aloud');assert.equal(creates,1);
  const tabId=(await state()).tabId;
  await send('Second selection.');
  await page.waitForFunction(()=>document.getElementById('text').value==='Second selection.');
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Reading aloud');
  assert.equal((await state()).tabId,tabId);assert.equal(creates,2);
  console.log('Established reader: replacement autoplays, saved voice/speed and pause/resume verified.');
  await send('```\nOnly code\n```');await page.waitForFunction(()=>!document.getElementById('paste-status').hidden);assert.equal(creates,2);
  await Promise.all([send('Older selection.'),send('Newest selection. 世界')]);
  await page.waitForFunction(()=>document.getElementById('text').value==='Newest selection. 世界');
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Reading aloud');
  // Exercise real player recovery with only the browser play rejection simulated.
  await page.evaluate(()=>{
    const play=HTMLMediaElement.prototype.play;
    window.restorePlay=()=>{HTMLMediaElement.prototype.play=play;};
    HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('User gesture required','NotAllowedError'));};
  });
  await send('Blocked playback selection.');
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Press Play to start');
  assert.equal(await page.locator('#play').evaluate(e=>e.classList.contains('autoplay-blocked')),true);
  const prepared=creates;
  await page.evaluate(()=>window.restorePlay());await page.click('#play');
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Reading aloud');assert.equal(creates,prepared);
  // Late clipboard results must not replace an incoming selection.
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>new Promise(r=>{window.resolveClipboard=r;})}}));
  await page.click('#paste-play');await page.waitForFunction(()=>!!window.resolveClipboard);
  await send('Wins over clipboard.');await page.waitForFunction(()=>document.getElementById('text').value==='Wins over clipboard.');
  await page.evaluate(()=>window.resolveClipboard('Stale clipboard text'));
  assert.equal(await page.locator('#text').inputValue(),'Wins over clipboard.');
  // A deliberately noncooperative importer proves the generation guard works.
  await page.route('**/pdf.js',r=>r.fulfill({contentType:'text/javascript',body:'export async function extractPdf(){return await new Promise(r=>window.resolvePdf=r)}'}));
  await page.locator('#pdf-file').setInputFiles({name:'late.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-test')});
  await page.waitForFunction(()=>!!window.resolvePdf);
  await send('Wins over PDF.');await page.waitForFunction(()=>document.getElementById('text').value==='Wins over PDF.');
  await page.evaluate(()=>window.resolvePdf({text:'Stale PDF text',pages:1}));
  assert.equal(await page.locator('#text').inputValue(),'Wins over PDF.');assert.equal(await page.locator('#clear').isEnabled(),true);
  console.log('Blocked autoplay resumes prepared audio; late clipboard and PDF results cannot overwrite a selection.');
  // Confirm duplicate acceptance never starts another job.
  const accepted=await state();assert.equal(accepted.pending,undefined);
  // Reloading the service worker module in a real stopped worker retains ownership.
  const session=await context.newCDPSession(page);await session.send('ServiceWorker.enable');await session.send('ServiceWorker.stopAllWorkers');
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator('#open').click();
  worker=context.serviceWorkers().filter(w=>w.url().includes(id)).at(-1)||await context.waitForEvent('serviceworker');
  assert.equal((await state()).tabId,tabId);
  await page.goto('about:blank');
  const nextPromise=context.waitForEvent('page');await send('After navigation.');const next=await nextPromise;
  await next.waitForFunction(()=>document.getElementById('text')?.value==='After navigation.');assert.notEqual((await state()).tabId,tabId);
  await next.close();
  const reopenedPromise=context.waitForEvent('page');await send('After closing.');const reopened=await reopenedPromise;
  await reopened.waitForFunction(()=>document.getElementById('text')?.value==='After closing.');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('Unpacked extension passed: real messaging, ownership, replacement, cleanup, worker restart, navigation and closed-tab recovery. No provider calls.');
} catch(error) {console.error('Open pages:',context.pages().map(p=>{const u=new URL(p.url());return u.origin+u.pathname;}));console.error(error);throw error;} finally {await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
