// Desktop Chrome only: synthetic clipboard/speech; network disabled after load.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.env.READER_SITE||'work/private-reader/site',isPublic=/RELEASE\s*=\s*["']production-public["']/.test(await readFile(root+'/app.js','utf8')),out='work/paste-promotion-2026-10-11/clipboard-'+(isPublic?'public':'staging');
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',/\.(js|mjs)$/.test(p)?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(await readFile(root+'/'+(p==='/'?'index.html':p.slice(1))));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true});
// Chrome may request its page icon after load; it is unrelated to a text action.
const textActionRequests=paths=>paths.filter(path=>!['/favicon.svg','/favicon.ico'].includes(path));
const checks=[];
try{
 for(const configuration of ['available','unavailable','retail']){
  const startupUnavailable=configuration==='unavailable',retail=configuration==='retail';
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),requests=[],paid=[],external=[],errors=[];let blocked=startupUnavailable;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const path=new URL(request.url()).pathname;requests.push(path);if(request.method()==='POST'&&/^\/api\/(readings|speech|ocr|summary)$/.test(path))paid.push(path);});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){external.push(url.origin);return route.abort();}if(url.pathname.startsWith('/api/'))return blocked?route.abort('internetdisconnected'):route.fulfill({json:url.pathname==='/api/reader'?{eligible:true,accessAllowed:true,account:{balance:1000000}}:retail?{available:true,retail:true,enabled:true,balance:{balance:500,held:0,spent:0,debt:0}}:{available:false}});return route.continue();});
  await page.addInitScript(()=>{
   localStorage.setItem('paste2speech.settings',JSON.stringify({engine:'browser',joinLines:false}));
   window.spoken=[];window.cancels=0;window.clipboardCalls=[];window.typeCalls=[];
   const synth=new EventTarget();synth.getVoices=()=>[];synth.cancel=()=>{cancels++;synth.speaking=false;};synth.speak=u=>{spoken.push(u.text);synth.speaking=true;};
   Object.defineProperty(window,'speechSynthesis',{value:synth});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
   window.installClipboard=(mode,plain='Fallback offline.')=>{
    window.clipboardCalls=[];window.typeCalls=[];window.releaseFallback=null;
    const call=method=>clipboardCalls.push({method,online:navigator.onLine,activation:navigator.userActivation.isActive});
    const item=types=>({types,getType:async type=>{typeCalls.push(type);if(mode==='representation')throw new DOMException('Missing representation','NotFoundError');return new Blob([type==='text/html'?'<strong>Rich offline.</strong>':mode==='blank'?'  ':plain],{type});}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
     ...(mode==='absent'?{}:{read:async()=>{
      call('read');
      const error={denied:'NotAllowedError',security:'SecurityError',abort:'AbortError',unsupported:'NotSupportedError',failure:'DataError',hold:'NotSupportedError'}[mode];
      if(error)throw new DOMException('Synthetic rich failure',error);
      if(['empty','fallback-empty','fallback-denied','fallback-failure'].includes(mode))return [];
      if(mode==='unknown')return [item(['application/x-custom'])];
      return [item(mode==='rich'?['text/plain','text/html']:['text/plain'])];
     }}),
     readText:async()=>{call('readText');if(mode==='fallback-denied')throw new DOMException('Synthetic plain denial','NotAllowedError');if(mode==='fallback-failure')throw new DOMException('Synthetic plain failure','NotSupportedError');if(mode==='hold')await new Promise(r=>window.releaseFallback=r);return mode==='fallback-empty'?'  ':plain;}
    }});
   };
  });
  await page.goto(origin);await page.locator('#voice-settings').evaluate(el=>el.open=true);await page.locator('#engine').selectOption('browser');
  if(retail)await page.waitForFunction(()=>document.querySelector('#document-ocr-balance').textContent.includes('500 OCR pages'));blocked=true;await context.setOffline(true);assert.equal(await page.evaluate(()=>navigator.onLine),false);
  const checkpoint=requests.length;
  const select=async(text,start=text.length,end=start)=>{if(await page.locator('#stop').isEnabled())await page.locator('#stop').click();await page.locator('#edit-mode').click();await page.locator('#text').fill(text);await page.locator('#text').focus();await page.locator('#text').evaluate((el,{start,end})=>el.setSelectionRange(start,end,'backward'),{start,end});};
  const settled=()=>page.waitForFunction(()=>!document.querySelector('#paste').disabled&&!document.querySelector('#paste-play').disabled);
  for(const button of ['#paste','#paste-play']){
   for(const mode of ['rich','absent','unsupported','failure','empty','blank','unknown','representation']){
    await select('Before selected after',7,15);await page.evaluate(mode=>installClipboard(mode),mode);
    const speechBefore=await page.evaluate(()=>spoken.length),actionCheckpoint=requests.length;
    await page.locator(button).click();await settled();
    if(button==='#paste')assert.deepEqual(textActionRequests(requests.slice(actionCheckpoint)).filter(path=>!(retail&&path==='/api/ocr/config')),[],'Paste needs no network; only existing background OCR balance refresh and incidental browser icons are allowed');
    const text=mode==='rich'?'**Rich offline.**':'Fallback offline.';
    assert.equal(await page.locator('#text').inputValue(),button==='#paste'?'Before '+text+' after':text);
    assert.equal(await page.evaluate(()=>spoken.length),speechBefore+(button==='#paste-play'?1:0));
    if(button==='#paste')assert.equal(await page.locator('#text').evaluate(el=>el.selectionStart),7+text.length);
    const calls=await page.evaluate(()=>clipboardCalls),expected=mode==='rich'?['read']:mode==='absent'?['readText']:['read','readText'];
    assert.deepEqual(calls.map(c=>c.method),expected);assert.ok(calls.every(c=>c.online===false));assert.equal(calls[0].activation,true);
    const types=await page.evaluate(()=>typeCalls);assert.equal(new Set(types).size,types.length);
    assert.equal(await page.locator('#paste-status').isVisible(),false);
    checks.push({configuration,startupUnavailable,button,mode,success:true,calls});
   }
   for(const mode of ['denied','security','abort','fallback-empty','fallback-denied','fallback-failure']){
    await select('Keep selected source.',5,13);await page.locator('#play').click();await page.locator('#edit-mode').click();
    await page.locator('#text').focus();await page.locator('#text').evaluate(el=>el.setSelectionRange(5,13));
    await page.evaluate(mode=>installClipboard(mode),mode);
    const actionCheckpoint=requests.length;
    const before=await page.evaluate(()=>({spoken:spoken.length,cancels,speaking:speechSynthesis.speaking,status:document.querySelector('#status').textContent}));
    await page.locator(button).click();await settled();
    assert.deepEqual(textActionRequests(requests.slice(actionCheckpoint)),[],'Unsuccessful clipboard action must make no requests');
    assert.equal(await page.locator('#text').inputValue(),'Keep selected source.');
    assert.deepEqual(await page.locator('#text').evaluate(el=>[el.selectionStart,el.selectionEnd]),[5,13]);
    assert.deepEqual(await page.evaluate(()=>({spoken:spoken.length,cancels,speaking:speechSynthesis.speaking,status:document.querySelector('#status').textContent})),before);
    const message=await page.locator('#paste-status').textContent();assert.match(message,/long-press|long.press/);assert.match(message,/unchanged/);
    const calls=await page.evaluate(()=>clipboardCalls);assert.deepEqual(calls.map(c=>c.method),['denied','security','abort'].includes(mode)?['read']:['read','readText']);
    checks.push({configuration,startupUnavailable,button,mode,preservesTextSelectionAndPlayback:true,calls,message});
   }
   // Native paste uses its event payload, independently of denied async reads.
   await select('Keep.',5,5);await page.evaluate(()=>installClipboard('denied'));await page.locator(button).click();await settled();
   await page.evaluate(()=>{const data=new DataTransfer();data.setData('text/html','<strong>Native.</strong>');data.setData('text/plain','Native.');document.querySelector('#text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
   assert.equal(await page.locator('#text').inputValue(),'Keep.**Native.**');assert.deepEqual(await page.evaluate(()=>clipboardCalls.map(c=>c.method)),['read']);
   for(const intervention of ['selection','edit','clear']){
    await select('abcdef',1,4);await page.evaluate(()=>installClipboard('hold','XYZ'));
    const speechBefore=await page.evaluate(()=>spoken.length);await page.locator(button).click();await page.waitForFunction(()=>typeof releaseFallback==='function');
    assert.equal(await page.locator('#paste').isDisabled(),true);assert.equal(await page.locator('#paste-play').isDisabled(),true);
    if(intervention==='selection')await page.locator('#text').evaluate(el=>el.setSelectionRange(0,0));
    if(intervention==='edit'){await page.locator('#text').focus();await page.keyboard.insertText('EDIT');}
    if(intervention==='clear')await page.locator('#clear').click();
    const source=await page.locator('#text').inputValue();await page.evaluate(()=>releaseFallback());await settled();
    assert.equal(await page.locator('#text').inputValue(),intervention==='selection'?(button==='#paste'?'aXYZef':'XYZ'):source);
    assert.equal(await page.evaluate(()=>spoken.length),speechBefore+(intervention==='selection'&&button==='#paste-play'?1:0));
    assert.deepEqual(await page.evaluate(()=>clipboardCalls.map(c=>c.method)),['read','readText']);
    checks.push({configuration,startupUnavailable,button,mode:'delayed-plain-fallback',intervention,preserved:true});
   }
  }
  assert.deepEqual(textActionRequests(requests.slice(checkpoint)).filter(path=>path!=='/api/events'&&!(retail&&path==='/api/ocr/config')),[],'Only existing optional playback telemetry and retail balance refresh may be attempted; no required network or assets');
  assert.deepEqual(paid,[]);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  checks.push({startupUnavailable,configuration,incidentalBrowserIconRequests:requests.slice(checkpoint).filter(path=>['/favicon.svg','/favicon.ico'].includes(path)),optionalPlaybackTelemetryAndBalanceRefresh:textActionRequests(requests.slice(checkpoint)),newRequiredRequests:textActionRequests(requests.slice(checkpoint)).filter(path=>path!=='/api/events'&&!(retail&&path==='/api/ocr/config')),paidPosts:paid,externalRequests:external,pageErrors:errors});
  await context.close();
 }
 const release=JSON.parse(await readFile(root+'/release.json','utf8'));
 await writeFile(out+'/clipboard-proof.json',JSON.stringify({commit:release.commit,dirty:release.dirty,network:'Desktop Chrome offline after assets loaded; startup API failure covered separately',clipboard:'Synthetic; no real clipboard or permission changes',speech:'Synthetic; no provider/account mutations',androidPolicyTested:false,checks},null,2)+'\n');
 console.log('PASS clipboard fallback: both offline buttons, rich/absent/unsupported/failure/empty/blank/unknown/representation, denial/cancellation, selection, ongoing playback, delayed edit/Clear races, native paste; no duplicate method or representation reads, no required text-action requests or failed-action requests; existing optional successful-playback telemetry and retail balance refresh fail safely; no provider requests. Android policy untested.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
