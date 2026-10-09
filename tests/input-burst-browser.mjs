// Native input and synthetic unchanged-input burst; no clipboard reads/provider calls.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const site=process.env.TEST_SITE||'work/private-reader/site',baseline=process.env.EXPECT_BASELINE==='1';
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(site+'/'+(path==='/'?'index.html':path.slice(1))));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[],external=[],posts=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.href);return route.abort();}if(url.pathname.startsWith('/api/')){if(route.request().method()==='POST'&&['/api/readings','/api/speech','/api/ocr','/api/summary'].includes(url.pathname))posts.push(url.pathname);return route.fulfill({json:url.pathname==='/api/reader'?{account:{balance:10000},accessAllowed:true,eligible:false,liveEnabled:false,voices:[]}:{available:false}});}return route.continue();});
await page.addInitScript(()=>{const synth=new EventTarget();synth.getVoices=()=>[];synth.cancel=()=>{};synth.speak=()=>{throw Error('unexpected speech');};Object.defineProperty(window,'speechSynthesis',{value:synth});window.SpeechSynthesisUtterance=class{};window.clipboardReads=0;window.clipboardWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>{window.clipboardReads++;throw Error('unexpected clipboard read');},readText:async()=>{window.clipboardReads++;throw Error('unexpected clipboard read');},writeText:async text=>window.clipboardWrites.push(text)}});});
const sentence='For updated conditions, the most useful resources are the [National Weather Service Grand Junction office](https://www.weather.gov/gjt/?utm_source=chatgpt.com) and the [Salt Lake City forecast office](https://www.weather.gov/slc/?utm_source=chatgpt.com).';
const full=sentence+'\n\n'+('Ordinary briefing context. '.repeat(1300)).slice(0,29294-sentence.length-2),first=full.slice(0,20000);
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#text');assert.equal(await page.locator('#text').evaluate(el=>el.maxLength),-1);
 await page.locator('#text').fill(first);
 const off=await page.evaluate(()=>{const input=document.querySelector('#text'),preview=document.querySelector('#preview'),node=preview.firstChild;let records=0;const observer=new MutationObserver(events=>records+=events.length);observer.observe(preview,{childList:true,subtree:true});const start=performance.now();for(let i=0;i<100;i++)input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:i%2?'fragment':null}));const elapsed=performance.now()-start;records+=observer.takeRecords().length;observer.disconnect();return {elapsedMs:elapsed,domMutations:records,sameNode:node===preview.firstChild};});
 if(baseline){assert.ok(off.domMutations>0);assert.equal(off.sameNode,false);}else{assert.equal(off.domMutations,0);assert.equal(off.sameNode,true);}assert.equal(await page.locator('#text').inputValue(),first);
 await page.locator('#clear').click();await page.locator('#paste-check summary').click();await page.locator('#paste-check-start').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#paste-check-report').value).versionCheck==='match');
 await page.evaluate(()=>{window.inputCount=0;document.querySelector('#text').addEventListener('input',()=>window.inputCount++);});
 await page.locator('#text').focus();await page.keyboard.insertText(first);assert.equal(await page.locator('#text').inputValue(),first);
 const on=await page.evaluate(()=>{const input=document.querySelector('#text'),preview=document.querySelector('#preview'),node=preview.firstChild;const start=performance.now();for(let i=0;i<100;i++)input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:i%3?'fragment':null}));return {elapsedMs:performance.now()-start,sameNode:node===preview.firstChild};});
 assert.equal(on.sameNode,!baseline);
 // Real changes after the cap must still update immediately and exceed 20,000.
 await page.keyboard.insertText(full.slice(20000));assert.equal(await page.locator('#text').inputValue(),full);assert.ok((await page.locator('#preview').textContent()).includes('Salt Lake City forecast office'));
 await page.keyboard.press('Backspace');assert.equal(await page.locator('#text').inputValue(),full.slice(0,-1));
 await page.locator('#paste-check-copy').click();const copied=await page.evaluate(()=>window.clipboardWrites.at(-1)),report=JSON.parse(copied);
 assert.equal(report.events.length,120);
 if(baseline){assert.equal(report.final,undefined);console.log('REPRODUCED capped report loses terminal summary.');}
 else{
  assert.equal(report.truncated,true);assert.ok(report.omittedEvents>0);assert.equal(report.final.editor.characters,29293);assert.equal(report.maximumEditorCharacters,29294);
  assert.equal(report.nativeInput.count,await page.evaluate(()=>window.inputCount));assert.ok(report.nativeInput.count>=103);assert.ok(report.eventCounts['input-unchanged-editor']>=100);assert.equal(report.eventCounts['preview-complete'],3);assert.ok(report.nativeInput.lastMs>=report.nativeInput.firstMs);
  assert.equal(await page.locator('#paste-check-report').inputValue(),copied);assert.ok(!copied.includes('Ordinary briefing'));
  console.log('PASS capped report: '+report.nativeInput.count+' inputs, '+report.eventCounts['input-unchanged-editor']+' unchanged, only 3 changed-source previews; exact maximum/final lengths 29,294/29,293 retained in copied report.');
 }
 console.log(JSON.stringify({mode:baseline?'baseline':'fixed',off,on,recordedEvents:report.events.length,omittedEvents:report.omittedEvents??null}));
 assert.equal(await page.evaluate(()=>window.clipboardReads),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(posts,[]);console.log('PASS no editor maxlength, exact 20,000 input and later 29,294 native text, immediate real edit/deletion, zero clipboard reads/provider calls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
