// Install the actual unpacked extension into an isolated Chrome profile. All
// reader HTTP traffic is fulfilled locally; no speech providers or accounts run.
import {chromium} from 'playwright';
import {readFile, mkdtemp, rm, cp, appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
const environment=process.argv.includes('--staging')?'staging':'production';
const reuseExisting=process.argv.includes('--reuse-existing');
const origin=environment==='staging'?'https://staging.pastetospeech.com':'https://pastetospeech.com';
const site=environment==='staging'?'work/private-reader/site':'work/production-reader/site';
const profile=await mkdtemp(tmpdir()+'/pastetospeech-extension-');
const extension=profile+'/extension';
const rootIndex=process.argv.indexOf('--extension-root');
const extensionRoot=rootIndex===-1?'dist/chrome-extension':process.argv[rootIndex+1];
if(!extensionRoot)throw new Error('--extension-root requires a directory');
await cp(resolve(extensionRoot+'/'+environment),extension,{recursive:true});
// Test-only entry point calls the exact context-menu handler; never packaged.
await appendFile(extension+'/background.js','\nglobalThis.__readSelection = readSelection; globalThis.__readMenuSelection = readMenuSelection;\n');
// Chrome's extension-created initial navigation can precede Playwright routing.
// Resolve the real test hostname to a local TLS server so it cannot hit live data.
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',profile+'/key.pem','-out',profile+'/cert.pem','-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
// Extension-created tabs can navigate before Playwright applies its TLS policy.
// Trust only this test's ephemeral certificate in the isolated Chrome profile.
const publicKey=execFileSync('openssl',['x509','-pubkey','-noout','-in',profile+'/cert.pem']);
const spki=createHash('sha256').update(execFileSync('openssl',['pkey','-pubin','-outform','DER'],{input:publicKey})).digest('base64');
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
const context=await chromium.launchPersistentContext(profile,{executablePath:'/usr/bin/google-chrome',headless:true,ignoreHTTPSErrors:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-proxy-server',`--ignore-certificate-errors-spki-list=${spki}`,`--host-resolver-rules=${mapping}`]});
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
  // A real pinned reader loaded before installation has no content-script relay.
  // Its older handoff counter also survives extension session-storage resets.
  let existing;
  if(reuseExisting){
    await context.addInitScript(origin=>{if(location.origin===origin)sessionStorage.setItem('pastetospeech.extension.accepted',JSON.stringify({sequence:77,id:'previous-extension-session'}));},origin);
    existing=await context.newPage();await existing.goto(origin+'/');
    await existing.waitForFunction(()=>document.getElementById('text'));
    await existing.locator('#text').fill('Untouched fixture text before explicit Read.');
  }
  const cdp=await context.browser().newBrowserCDPSession();
  const workerPromise=context.waitForEvent('serviceworker');
  workerPromise.catch(()=>{});
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:extension});
  let worker=context.serviceWorkers().find(w=>w.url().includes(id))||await workerPromise;
  const send=text=>worker.evaluate(text=>globalThis.__readSelection(text),text);
  const state=()=>worker.evaluate(async()=>(await chrome.storage.session.get('handoff')).handoff);
  let expectedExistingId;
  if(reuseExisting){
    expectedExistingId=await worker.evaluate(async origin=>{
      const [tab]=await chrome.tabs.query({url:origin+'/*'});
      await chrome.tabs.update(tab.id,{pinned:true});return tab.id;
    },origin);
    assert.equal(await existing.locator('#text').inputValue(),'Untouched fixture text before explicit Read.');
  }
  const firstPage=existing?Promise.resolve(existing):context.waitForEvent('page');firstPage.catch(()=>{});
  await send('First selection.');
  const page=await firstPage;
  if(reuseExisting){
    assert.equal((await state()).tabId,expectedExistingId);
    const tab=await worker.evaluate(async id=>{const tab=await chrome.tabs.get(id);return {pinned:tab.pinned,url:tab.url};},expectedExistingId);
    assert.equal(tab.pinned,true);assert.equal(tab.url,origin+'/');
    console.log('Existing pinned reader adopted without reload/navigation; missing relay recovered and prior sequence 77 superseded.');
  }
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
  await page.click('#speed-preset');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'speed-preset','Background preparation must not steal focus back from controls');
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
  // Exercise the packaged context-menu capture path in Chrome's isolated world.
  // This fixture uses the existing reader-origin grant; native menu invocation
  // grants activeTab on ordinary external pages (manual acceptance remains).
  const source=await context.newPage();
  await source.goto(origin+'/selection-fixture');
  await source.setContent('<div id="selected"><p>First paragraph</p><p>Second paragraph</p><ul><li>One item</li><li>Two items</li></ul></div>');
  await source.bringToFront();
  const snapshot=await source.evaluate(()=>{
    const range=document.createRange();range.selectNodeContents(document.querySelector('#selected'));
    getSelection().removeAllRanges();getSelection().addRange(range);
    addEventListener('blur',()=>getSelection().removeAllRanges(),{once:true});
    return getSelection().toString().replace(/[\n\r\t\u2028\u2029]/g,' ').trim();
  });
  await worker.evaluate(async({url,snapshot})=>{
    const [tab]=await chrome.tabs.query({url});
    return globalThis.__readMenuSelection({menuItemId:'read',selectionText:snapshot,frameId:0},tab);
  },{url:origin+'/selection-fixture',snapshot});
  const formatted='First paragraph\n\nSecond paragraph\n\n- One item\n- Two items';
  await reopened.waitForFunction(text=>document.getElementById('text')?.value===text,formatted);
  assert.equal(await reopened.locator('#text').inputValue(),formatted);
  // Restricted pages must still deliver Chrome's snapshot without broader access.
  await worker.evaluate(async()=>{
    const tab=await chrome.tabs.create({url:'chrome://version',active:false});
    try {return await globalThis.__readMenuSelection({menuItemId:'read',selectionText:'Restricted selected snapshot.',frameId:0},tab);}
    finally {await chrome.tabs.remove(tab.id);}
  });
  await reopened.waitForFunction(()=>document.getElementById('text')?.value==='Restricted selected snapshot.');
  console.log('Context-menu capture: paragraphs/list boundaries survive real scripting + handoff; chrome:// denial falls back intact.');
  if(reuseExisting){
    const retainedId=(await state()).tabId;
    await worker.evaluate(id=>chrome.tabs.update(id,{pinned:true}),retainedId);
    const newWorker=context.waitForEvent('serviceworker');newWorker.catch(()=>{});
    // CDP-installed test extensions are session-owned. Unload/load that same
    // package explicitly rather than relying on runtime.reload's installation
    // lifecycle; this resets extension state and invalidates the old relay.
    await cdp.send('Extensions.uninstall',{id});
    const reinstalled=await cdp.send('Extensions.loadUnpacked',{path:extension});
    assert.equal(reinstalled.id,id);
    worker=context.serviceWorkers().filter(w=>w.url().includes(id)).at(-1)||await newWorker;
    assert.equal(await reopened.locator('#text').inputValue(),'Restricted selected snapshot.','Extension reload preserves the reader text');
    await send('After extension reload.');
    await reopened.waitForFunction(()=>document.getElementById('text')?.value==='After extension reload.');
    assert.equal((await state()).tabId,retainedId);
    assert.equal(await worker.evaluate(async id=>(await chrome.tabs.get(id)).pinned,retainedId),true);
    console.log('Extension unload/reinstall: pinned reader and text retained; next explicit selection delivered without page reload.');
  }

  assert.equal(errors.length,0,errors.join('\n'));
  console.log('Unpacked extension passed: real messaging, ownership, replacement, cleanup, worker restart, navigation and closed-tab recovery. No provider calls.');
} catch(error) {console.error('Open pages:',context.pages().map(p=>p.url()));console.error(error);throw error;} finally {await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
