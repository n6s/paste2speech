// Complete built UI, synthetic links, mocked metadata and speech only.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const site=process.env.TEST_SITE||'work/private-reader/site';
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;res.setHeader('Content-Type',path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path==='/paste.js'?'public/paste.js':path==='/clipboard-payload.js'?'public/clipboard-payload.js':site+'/'+(path==='/'?'index.html':path.slice(1))));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[],external=[],paid=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'){external.push(url.href);return route.abort();}if(url.pathname.startsWith('/api/')){if(['/api/readings','/api/speech','/api/ocr','/api/summary'].includes(url.pathname)&&route.request().method==='POST')paid.push(url.pathname);return route.fulfill({json:url.pathname==='/api/reader'?{account:{balance:10000},accessAllowed:true,eligible:false,liveEnabled:false,voices:[]}:{available:false}});}return route.continue();});
// Record speech starts; completion/chunk progression is covered by playback gates.
await page.addInitScript(()=>{window.spoken=[];const synth=new EventTarget();synth.getVoices=()=>[];synth.cancel=()=>{};synth.speak=u=>{window.spoken.push(u.text);};Object.defineProperty(window,'speechSynthesis',{value:synth});window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};});

const first='National Weather Service Grand Junction office',second='Salt Lake City forecast office';
const sentence='For updated conditions, the most useful resources are the [National Weather Service Grand Junction office](https://www.weather.gov/gjt/?utm_source=chatgpt.com) and the [Salt Lake City forecast office](https://www.weather.gov/slc/?utm_source=chatgpt.com).';
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#text');
 await page.evaluate(()=>{window.inputEvents=[];for(const type of ['paste','beforeinput','input'])document.querySelector('#text').addEventListener(type,event=>window.inputEvents.push({type,inputType:event.inputType,length:event.data?.length,html:event.clipboardData?.types.includes('text/html')}),true);});
 for(const size of [sentence.length,30075]){
  const text=sentence+'\n\n'+('Ordinary briefing context with clouds and sunshine. '.repeat(650)).slice(0,Math.max(0,size-sentence.length-2));
  await page.locator('#text').fill('');await page.locator('#text').focus();await page.evaluate(()=>window.inputEvents=[]);
  const start=performance.now();await page.keyboard.insertText(text);const ms=performance.now()-start;
  assert.equal(await page.locator('#text').inputValue(),text);const preview=await page.locator('#preview').textContent();assert.ok(preview.includes(first));assert.ok(preview.includes(second));
  console.log(JSON.stringify({mode:'Chrome keyboard.insertText',characters:text.length,elapsedMs:ms,events:await page.evaluate(()=>window.inputEvents),storedMarkdownIntact:true,previewLabelsIntact:true}));
 }
 const html='<p>For updated conditions, the most useful resources are the <a href="https://www.weather.gov/gjt/?utm_source=chatgpt.com">'+first+'</a> and the <a href="https://www.weather.gov/slc/?utm_source=chatgpt.com">'+second+'</a>.</p>';
 for(const sample of [html,html.replace(first,'').replace(second,'')]){
  await page.locator('#text').fill('');await page.locator('#text').focus();await page.evaluate(()=>window.inputEvents=[]);
  await page.evaluate(({html,plain})=>{const data=new DataTransfer();data.setData('text/plain',plain);data.setData('text/html',html);document.querySelector('#text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{html:sample,plain:sentence});
  const stored=await page.locator('#text').inputValue();console.log(JSON.stringify({mode:'dual-format paste',htmlLabels:sample.includes(first),plainLabels:true,stored,events:await page.evaluate(()=>window.inputEvents)}));
  assert.ok(stored.includes(first));assert.ok(stored.includes(second));assert.equal(stored,sentence);
 }

 const empty=html.replace(first,'').replace(second,'');

 await page.locator('#options').evaluate(el=>{for(let node=el.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;});
 const full='Ordinary briefing context. '.repeat(1200).slice(0,30075-sentence.length-2)+'\n\n'+sentence;
 for(const citations of [true,false])for(const urls of [true,false]){
  await page.locator('#text').fill('');await page.locator('#text').focus();
  await page.evaluate(({html,plain})=>{const data=new DataTransfer();data.setData('text/plain',plain);data.setData('text/html',html);document.querySelector('#text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{html:empty,plain:full});
  await page.locator('#clean-citations').setChecked(citations);await page.locator('#clean-urls').setChecked(urls);
  assert.equal(await page.locator('#text').inputValue(),full);const preview=await page.locator('#preview').textContent();assert.ok(preview.includes(first));assert.ok(preview.includes(second));assert.equal(preview.includes('https://www.weather.gov'),!urls);
 }
 console.log('PASS 30,075-character dual-format paste retains exact original across URL/reference toggles.');
 const checks=await page.evaluate(async({empty,html,sentence})=>{
  const {clipboardMarkdown}=await import('/paste.js');const {clipboardPayload}=await import('/clipboard-payload.js');
  const cases=[
   ['valid-rich', '<h2>Weather</h2>'+html, sentence],
   ['missing-label', empty, sentence],
   ['multiline-context', empty, 'First paragraph.\n\n'+sentence+'\n\nLast paragraph.'],
   ['full-30k-context', empty, 'a'.repeat(30075-sentence.length-2)+'\n\n'+sentence],
   ['malformed-plain',empty,sentence.replace('office]','office').replace('office]','office')],
   ['other-destination',empty,sentence.replaceAll('weather.gov','example.invalid')],
   ['empty-plain',empty,''],
   ['escaped-plain',empty,'\\[Office](https://www.weather.gov/gjt/?utm_source=chatgpt.com)'],
   ['image-plain',empty,'![Office](https://www.weather.gov/gjt/?utm_source=chatgpt.com)'],
   ['symbol-label',empty,'[***](https://www.weather.gov/gjt/?utm_source=chatgpt.com)'],
  ];
  const output=[];for(const [name,html,plain]of cases){const start=performance.now();const result=clipboardMarkdown(html,plain);output.push({name,result,ms:performance.now()-start});}
  const item={types:['text/html','text/plain'],getType:async type=>new Blob([type==='text/html'?empty:sentence],{type})};
  const payload=await clipboardPayload({read:async()=>[item]});return {output,payload};
 },{empty,html,sentence});
 for(const test of checks.output){if(['missing-label','multiline-context','full-30k-context','other-destination'].includes(test.name)){assert.ok(test.result.includes(first));assert.ok(test.result.includes(second));}else if(test.name==='valid-rich'){assert.ok(test.result.startsWith('## Weather'));assert.ok(test.result.includes(first));}else assert.ok(!test.result.includes(first));assert.ok(test.ms<1500);console.log(JSON.stringify({name:test.name,characters:test.result.length,ms:test.ms}));}
 assert.equal(checks.payload.text,sentence);assert.equal(checks.payload.image,null);
 await page.locator('#engine').evaluate(el=>{for(let node=el.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;});await page.locator('#engine').selectOption('browser');
 for(const order of ['same-item','html-first','plain-first']){
  await page.locator('#edit-mode').click();
  await page.evaluate(({html,plain,order})=>{
   window.spoken=[];const make=types=>({types,getType:async type=>new Blob([type==='text/html'?html:plain],{type})});
   const items=order==='same-item'?[make(['text/html','text/plain'])]:order==='html-first'?[make(['text/html']),make(['text/plain'])]:[make(['text/plain']),make(['text/html'])];
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>items}});
  },{html:empty,plain:full,order});
  await page.locator('#paste-play').click();await page.waitForFunction(()=>!document.querySelector('#paste-play').disabled);assert.equal(await page.evaluate(()=>window.spoken.length),1,'Explicit Paste & Play starts browser speech');
  assert.equal(await page.locator('#text').inputValue(),full);const preview=await page.locator('#preview').textContent();assert.ok(preview.includes(first));assert.ok(preview.includes(second));console.log('PASS Clear, Paste & Play: '+order+' retains exact 30,075-character source and both labels; mocked browser speech only.');
 }


 // Actual phone shape: one item; larger HTML omits both anchors, not only labels.
 const missing='For updated conditions, the most useful resources are the  and the .';
 const fillTo=(text,length)=>text+'\n\n'+('Ordinary briefing context. '.repeat(1300)).slice(0,length-text.length-2).trimEnd().padEnd(length-text.length-2,'x');
 const phonePlain=fillTo(sentence,29294),display=fillTo(missing,30076);
 const paragraphs=display.split('\n\n').map(text=>'<p>'+text+'</p>').join('');
 const phoneHTML='<div data-padding="'+'x'.repeat(31346-('<div data-padding="">'+paragraphs+'</div>').length)+'">'+paragraphs+'</div>';
 assert.equal(phonePlain.length,29294);assert.equal(phoneHTML.length,31346);assert.ok(!phoneHTML.includes(first));assert.ok(!phoneHTML.includes('weather.gov'));
 const renderedPhoneHTML=await page.evaluate(async html=>(await import('/paste.js')).clipboardMarkdown(html),phoneHTML);assert.equal(renderedPhoneHTML.length,30075);assert.ok(!renderedPhoneHTML.includes(first));
 await page.locator('#clean-urls').check();await page.locator('#clean-citations').check();
 await page.locator('#edit-mode').click();await page.locator('#text').fill('');await page.locator('#text').focus();await page.keyboard.insertText(phonePlain);const nativePreview=await page.locator('#preview').textContent();
 for(const order of ['same-plain-first','same-html-first','split-html-first','split-plain-first']){
  await page.locator('#edit-mode').click();
  await page.evaluate(({html,plain,order})=>{window.spoken=[];const make=types=>({types,getType:async type=>new Blob([type==='text/html'?html:plain],{type})});const items=order==='same-plain-first'?[make(['text/plain','text/html'])]:order==='same-html-first'?[make(['text/html','text/plain'])]:order==='split-html-first'?[make(['text/html']),make(['text/plain'])]:[make(['text/plain']),make(['text/html'])];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>items}});},{html:phoneHTML,plain:phonePlain,order});
  await page.locator('#paste-play').click();await page.waitForFunction(()=>!document.querySelector('#paste-play').disabled);assert.equal(await page.evaluate(()=>window.spoken.length),1,'Explicit Paste & Play starts browser speech');assert.equal(await page.locator('#text').inputValue(),phonePlain);assert.equal(await page.locator('#preview').textContent(),nativePreview);console.log('PASS observed no-anchor phone shape: '+order+', intact 29,294-character source, 31,346-character HTML and keyboard-equivalent preview.');
 }
 await page.locator('#edit-mode').click();await page.locator('#text').fill('');await page.locator('#text').focus();
 await page.evaluate(({html,plain})=>{const data=new DataTransfer();data.setData('text/html',html);data.setData('text/plain',plain);document.querySelector('#text').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{html:phoneHTML,plain:phonePlain});assert.equal(await page.locator('#text').inputValue(),phonePlain);assert.equal(await page.locator('#preview').textContent(),nativePreview);
 const generic=await page.evaluate(async()=>{
  const {clipboardMarkdown}=await import('/paste.js');
  const plain='Read [Harbor reading archive](https://example.invalid/archive) and [Ada Lovelace biography](https://example.invalid/ada).';
  const dropped='<h2>Sources</h2><p>Read  and .</p>';
  const intact='<h2>Sources</h2><p>Read <b>Harbor reading archive</b> and <em>Ada Lovelace biography</em>.</p>';
  const repeated='[Harbor archive](https://example.invalid/a) and [Harbor archive](https://example.invalid/b)';
  const start=performance.now();const selected=clipboardMarkdown(dropped,plain);const rich=clipboardMarkdown(intact,plain);const repeat=clipboardMarkdown('<p>Harbor archive and .</p>',repeated);
  return {plain,selected,rich,repeated,repeat,ms:performance.now()-start};
 });assert.equal(generic.selected,generic.plain);assert.ok(generic.rich.startsWith('## Sources'));assert.equal(generic.repeat,generic.repeated);assert.ok(generic.ms<1500);console.log('PASS generic named labels and occurrence loss; intact rich formatting retained.');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(paid,[]);
 console.log('PASS: exact supplied Markdown survives Chrome native insertText and normal dual-format paste; incomplete HTML preserves intact named Markdown source, including the confirmed no-anchor phone shape. Zero provider calls. Keyboard delay remains separate.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
