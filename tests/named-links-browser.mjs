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
const first='National Weather Service Grand Junction office',second='Salt Lake City forecast office',prefix='For updated conditions, the most useful resources are the ';
const source=prefix+`linkhttps://example.invalid/a${first} and the citehttps://example.invalid/b${second}.`;
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#clean-urls',{state:'attached'});
 await page.locator('#engine').evaluate(el=>{for(let node=el.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;});await page.locator('#engine').selectOption('browser');
 await page.locator('#options').evaluate(el=>{for(let node=el.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;});
 for(const citations of [true,false])for(const urls of [true,false]){
  await page.locator('#text').fill(source);await page.locator('#clean-citations').setChecked(citations);await page.locator('#clean-urls').setChecked(urls);
  const expected=prefix+first+(urls?'':' (https://example.invalid/a)')+' and the '+second+(urls?'':' (https://example.invalid/b)')+'.';
  assert.equal(await page.locator('#text').inputValue(),source);assert.equal(await page.locator('#preview').textContent(),expected);
  const chunks=await page.locator('#preview .sentence').allTextContents();assert.ok(chunks.join(' ').includes(first));assert.ok(chunks.join(' ').includes(second));
 }
 await page.locator('#clean-citations').check();await page.locator('#clean-urls').check();
 await page.locator('#read-mode').click();await page.locator('#play').click();await page.waitForFunction(()=>window.spoken.length>0);assert.equal((await page.evaluate(()=>window.spoken)).join(' '),prefix+first+' and the '+second+'.');
 await page.locator('#edit-mode').click();
 const html=`<p>${prefix}<a href="https://example.invalid/a">${first}</a> and the <a href="https://example.invalid/b">${second}</a>.</p>`;
 await page.locator('#text').fill('');await page.locator('#text').focus();await page.evaluate(html=>{const data=new DataTransfer();data.setData('text/html',html);document.querySelector('#text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},html);
 assert.equal(await page.locator('#preview').textContent(),prefix+first+' and the '+second+'.');assert.match(await page.locator('#text').inputValue(),/\[National Weather/);
 // Full paste/input path at the reported size, with a single unwrapped line.
 // Plain text and HTML are separate sources; missing clipboard words cannot
 // be recovered by later cleanup.
 for(const format of ['plain','html']){
  const plain='a'.repeat(30075),html='<p>'+plain+'</p>';
  await page.locator('#text').fill('');await page.locator('#text').focus();
  const ms=await page.evaluate(({format,plain,html})=>{
   const input=document.querySelector('#text'),data=new DataTransfer();data.setData('text/plain',plain);if(format==='html')data.setData('text/html',html);
   const start=performance.now();if(input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))){input.setRangeText(plain,0,0,'end');input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste',data:plain}));}return performance.now()-start;
  },{format,plain,html});
  assert.equal(await page.locator('#text').inputValue(),plain);assert.equal(await page.locator('#preview').textContent(),plain);assert.ok(ms<1500,format+' paste stalled: '+ms+'ms');console.log(format+' 30,075-character paste/input: '+ms.toFixed(2)+'ms');
 }
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(paid,[]);
 console.log('PASS named-link labels: URL/reference combinations, original source, preview and speech chunks, mocked browser speech, normal rich HTML paste, 390/320px; zero external/provider calls.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
