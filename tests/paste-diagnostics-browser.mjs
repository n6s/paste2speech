// Complete built UI, synthetic links, mocked metadata and speech only.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const site=process.env.TEST_SITE||'work/private-reader/site';
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(site+'/'+(path==='/'?'index.html':path.slice(1))));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[],external=[],paid=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.href);return route.abort();}if(url.pathname.startsWith('/api/')){if(['/api/readings','/api/speech','/api/ocr','/api/summary'].includes(url.pathname)&&route.request().method==='POST')paid.push(url.pathname);return route.fulfill({json:url.pathname==='/api/reader'?{account:{balance:10000},accessAllowed:true,eligible:false,liveEnabled:false,voices:[]}:{available:false}});}return route.continue();});
await page.addInitScript(()=>{window.spoken=[];const synth=new EventTarget();synth.getVoices=()=>[];synth.cancel=()=>{};synth.speak=u=>{window.spoken.push(u.text);queueMicrotask(()=>u.onend?.());};Object.defineProperty(window,'speechSynthesis',{value:synth});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};});

const diagnosticPosts=[];page.on('request',request=>{if(request.method()==='POST'&&/paste-evidence|knownWeatherSentence|clipboard-html-result|PRIVATE-CONTENT/.test(request.postData()||''))diagnosticPosts.push(request.url());});
const source='For updated conditions, the most useful resources are the [National Weather Service Grand Junction office](https://www.weather.gov/gjt/?utm_source=chatgpt.com) and the [Salt Lake City forecast office](https://www.weather.gov/slc/?utm_source=chatgpt.com).';
const secret='PRIVATE-CONTENT-DO-NOT-SHARE https://private.invalid/secret';
const full=secret+'\n\n'+source+'\n\n'+'Ordinary briefing context. '.repeat(1200).slice(0,30075-secret.length-source.length-4);
const html='<p>'+secret+'</p><p>For updated conditions, the most useful resources are the <a href="https://www.weather.gov/gjt/?utm_source=chatgpt.com"></a> and the <a href="https://www.weather.gov/slc/?utm_source=chatgpt.com"></a>.</p>';
try{
 await page.goto('http://127.0.0.1:'+server.address().port+(process.env.TEST_PUBLIC==='1'?'':'/?testing=1'));await page.waitForSelector('#text');
 const isPublic=process.env.TEST_PUBLIC==='1';
 if(isPublic){assert.equal(await page.locator('#paste-check').count(),0);console.log('PASS public build exposes no paste diagnostic facility.');}
 else{
  await page.locator('#paste-check summary').click();
  await page.locator('#engine').evaluate(el=>{for(let node=el.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;});await page.locator('#engine').selectOption('browser');
  await page.evaluate(()=>{window.cancelCalls=0;speechSynthesis.cancel=()=>window.cancelCalls++;speechSynthesis.speak=u=>window.spoken.push(u.text);});
  await page.locator('#text').fill(source);await page.locator('#play').click();await page.waitForFunction(()=>window.spoken.length>0);await page.evaluate(()=>window.cancelCalls=0);
  await page.locator('#paste-check-start').click();assert.equal(await page.locator('#text').inputValue(),source);assert.ok(await page.evaluate(()=>window.cancelCalls>0));assert.ok(await page.locator('#play').isDisabled());
  await page.locator('#paste-check-discard').click();await page.locator('#edit-mode').click();
  await page.evaluate(()=>{window.spoken=[];speechSynthesis.speak=u=>{window.spoken.push(u.text);queueMicrotask(()=>u.onend?.());};});
  console.log('PASS Start check preserves existing source and pauses active mocked playback.');

  await page.evaluate(()=>{window.clipboardReads=0;window.clipboardWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>{window.clipboardReads++;return [];},readText:async()=>{window.clipboardReads++;return 'must not read automatically';},writeText:async text=>window.clipboardWrites.push(text)}});});
  await page.locator('#text').fill(secret);assert.equal(await page.locator('#paste-check-report').inputValue(),'');
  await page.locator('#paste-check-start').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#paste-check-report').value).versionCheck==='match');assert.equal(await page.evaluate(()=>window.clipboardReads),0);
  await page.locator('#text').fill('');await page.locator('#text').focus();const start=performance.now();await page.keyboard.insertText(full);const elapsed=performance.now()-start;
  assert.equal(await page.locator('#text').inputValue(),full);const keyboardPreview=await page.locator('#preview').textContent();assert.ok(elapsed<1500,'keyboard insertion stalled '+elapsed+'ms');
  await page.locator('#paste-check-copy').click();let report=JSON.parse(await page.locator('#paste-check-report').inputValue());
  assert.equal(report.versionCheck,'match');assert.equal(report.cleanup.urls,true);assert.ok(report.events.some(e=>e.stage==='beforeinput-data'&&e.inputType==='insertText'));assert.ok(report.events.some(e=>e.stage==='input-editor-after'&&e.text.characters===full.length));assert.ok(!report.events.some(e=>e.stage==='paste-event-plain'));assert.ok(report.events.some(e=>e.stage==='preview-complete'&&e.editorUnchanged));assert.ok(!JSON.stringify(report).includes('PRIVATE-CONTENT'));assert.ok(!JSON.stringify(report).includes('private.invalid'));assert.equal(await page.evaluate(()=>window.clipboardWrites.length),1);assert.deepEqual(await page.evaluate(()=>window.spoken),[]);
  console.log('PASS keyboard diagnostic: native insertText, exact 30,075-character source, privacy, no clipboard reads, version match; '+elapsed.toFixed(1)+'ms.');
  const buttonPreviews=[];
  for(const mode of ['same-item','split-items','readText']){
   await page.locator('#edit-mode').click();await page.locator('#paste-check-start').click();
   await page.evaluate(({html,plain,mode})=>{window.clipboardReads=0;const make=types=>({types,getType:async type=>new Blob([type==='text/html'?html:plain],{type})});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{...(mode==='readText'?{readText:async()=>{window.clipboardReads++;return plain;}}:{read:async()=>{window.clipboardReads++;await new Promise(resolve=>setTimeout(resolve,80));return mode==='same-item'?[make(['text/html','text/plain'])]:[make(['text/html']),make(['text/plain'])];}}),writeText:async text=>window.clipboardWrites.push(text)}});},{html,plain:full,mode});
   await page.locator('#paste-play').click();await page.waitForFunction(()=>!document.querySelector('#paste-play').disabled);
   assert.equal(await page.locator('#text').inputValue(),full);buttonPreviews.push(await page.locator('#preview').textContent());assert.equal(await page.evaluate(()=>window.clipboardReads),1);assert.deepEqual(await page.evaluate(()=>window.spoken),[]);
   await page.locator('#paste-check-copy').click();report=JSON.parse(await page.locator('#paste-check-report').inputValue());
   assert.ok(report.events.some(e=>e.stage==='paste-button-start'));assert.ok(report.events.some(e=>e.stage==='paste-button-editor-assigned'&&e.text.grandJunctionLabel&&e.text.saltLakeLabel));assert.ok(report.events.some(e=>e.stage==='copy-editor'&&e.text.characters===full.length));
   if(mode!=='readText'){assert.ok(report.events.some(e=>e.stage==='clipboard-plain-result'));assert.ok(report.events.some(e=>e.stage==='clipboard-html-result'&&e.text.grandJunctionLabel===false&&e.weatherAnchors.length===2));assert.ok(report.events.some(e=>e.stage==='clipboard-read-result'&&e.sincePreviousMs>=60));}else assert.ok(report.events.some(e=>e.stage==='clipboard-readText-result'));
   assert.ok(!JSON.stringify(report).includes('PRIVATE-CONTENT'));assert.ok(!JSON.stringify(report).includes('private.invalid'));assert.ok(!JSON.stringify(report).includes('<p>'));console.log('PASS actual paste button diagnostic: '+mode+', stage signatures, timings, source/preview equality, privacy and zero speech.');
  }
  for(const value of buttonPreviews)assert.equal(value,keyboardPreview);
  // Native rich paste also runs the existing real handler and converter.
  await page.locator('#edit-mode').click();await page.locator('#paste-check-start').click();await page.locator('#text').fill('');await page.locator('#text').focus();
  await page.evaluate(({html,plain})=>{const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',plain);document.querySelector('#text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{html,plain:full});
  assert.equal(await page.locator('#text').inputValue(),full);await page.locator('#paste-check-copy').click();report=JSON.parse(await page.locator('#paste-check-report').inputValue());assert.ok(report.events.some(e=>e.stage==='paste-event-plain'));assert.ok(report.events.some(e=>e.stage==='paste-event-html-import'&&e.text.grandJunctionLabel));
  await page.locator('#paste-check-discard').click();assert.equal(await page.locator('#paste-check-report').inputValue(),'');await page.locator('#text').fill(secret);assert.equal(await page.locator('#paste-check-report').inputValue(),'');await page.reload();assert.equal(await page.locator('#paste-check-report').inputValue(),'');

  await page.locator('#paste-check summary').click();await page.route('**/release.json',route=>route.fulfill({json:{commit:'0'.repeat(40)}}));await page.locator('#paste-check-start').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#paste-check-report').value).versionCheck==='mismatch');assert.match(await page.locator('#paste-check-status').textContent(),/different build/);await page.locator('#paste-check-discard').click();
  for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 }
 assert.deepEqual(diagnosticPosts,[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(paid,[]);console.log('PASS opt-in staging evidence, discard/reload, mobile layout, zero external/provider calls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
