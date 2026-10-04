// Real browser checks; all account and reading calls are intercepted.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {WAVENET_VOICE_IDS,WAVENET_VOICES} from '../../public/wavenet-voices.js';
import {inspectMp3} from '../../cloudflare/prepared/mp3.js';
let assets;
const server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://local').pathname,file=path==='/'?'index.html':path.slice(1);
 res.setHeader('Content-Type',file.endsWith('.mp3')?'audio/mpeg':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
 res.end(await readFile(`${assets}/${file}`));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true});
await mkdir('work/voice-previews',{recursive:true});
try{
 for(const environment of ['staging','production']){
  assets=environment==='staging'?'work/private-reader/site':'work/production-reader/site';
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const Original=window.Audio;window.__audio=[];window.__spoken=[];Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel(){},speak(u){window.__spoken.push(u.text);u.onboundary?.({name:'word',charIndex:3});},addEventListener(){}}});window.Audio=function(...args){const audio=new Original(...args);window.__audio.push(audio);return audio;};});
  let config={account:null,eligible:false},mutations=0;
  const reading=await readFile('tests/fixtures/wavenet/en-US-Wavenet-F-00.mp3'),mp3=inspectMp3(reading);
  await page.route('**/api/**',async route=>{
   const r=route.request(),path=new URL(r.url()).pathname;
   if(r.method()!=='GET'&&/^\/api\/(readings|billing)/.test(path))mutations++;
   if(path==='/api/reader')return route.fulfill({json:config});
   if(path==='/api/readings'&&r.method()==='POST')return route.fulfill({json:{id:'preview-check'}});
   if(path.endsWith('/sections/0')||path.endsWith('/audio'))return route.fulfill({contentType:'audio/mpeg',body:reading});
   if(path==='/api/readings/preview-check')return route.fulfill({json:{id:'preview-check',state:'ready',starts:[0],duration:mp3.samples/24000,completed:1,total:1,sections:[{index:0,start:0,samples:mp3.samples,bytes:mp3.bytes}],delivery:'mse'}});
   return route.fulfill({json:{}});
  });
  await page.goto(origin);
  assert.equal(await page.locator('#voice-settings').evaluate(e=>e.open),false);
  assert.equal(await page.locator('.voice-discovery').isVisible(),true);
  assert.equal(await page.locator('#voice-preview-panel').evaluate(e=>e.open),false);
  const info=page.locator('#voice-info-panel'),infoSummary=info.locator('summary');
  assert.equal(await info.evaluate(e=>e.open),false);assert.equal(await info.locator('p').first().isVisible(),false);
  assert.equal(await infoSummary.textContent(),'Tell me more');await infoSummary.focus();await page.keyboard.press('Enter');
  assert.equal(await info.evaluate(e=>e.open),true);assert.equal(await info.locator('p').first().isVisible(),true);
  assert.match(await info.textContent(),/text-to-speech/);assert.match(await info.textContent(),/not guaranteed on every device/);
  assert.match(await info.textContent(),/download an MP4 recording with built-in subtitles/);assert.match(await info.textContent(),/replay without using more speech credits/);
  await page.keyboard.press('Space');assert.equal(await info.evaluate(e=>e.open),false);
  await infoSummary.click();assert.equal(await info.evaluate(e=>e.open),true);
  await page.locator('#voice-preview-panel summary').click();
  const buttons=page.locator('[data-preview-src]');assert.equal(await buttons.count(),4);
  await page.fill('#text','My own text must survive a voice preview.');
  const initial=await page.evaluate(()=>({text:document.querySelector('#text').value,engine:document.querySelector('#engine').value,rate:document.querySelector('#rate').value,settings:localStorage.getItem('paste2speech.settings')}));
  for(let i=0;i<4;i++){
   await buttons.nth(i).click();await page.waitForFunction(()=>document.querySelector('#voice-preview-status').textContent.startsWith('Playing'));
   assert.equal(await page.evaluate(()=>__audio.filter(a=>!a.paused).length),1);
   assert.equal(await page.evaluate(()=>__audio.find(a=>a.src.includes('/voice-previews/')).playbackRate),1);
  }
  await buttons.nth(3).click();assert.match(await page.locator('#voice-preview-status').textContent(),/stopped/);
  await buttons.nth(2).click();await page.waitForFunction(()=>document.querySelector('#voice-preview-status').textContent.startsWith('Playing'));
  await page.evaluate(()=>__audio.find(a=>a.src.includes('/voice-previews/')).dispatchEvent(new Event('ended')));
  assert.match(await page.locator('#voice-preview-status').textContent(),/finished/);
  assert.equal(mutations,0,'Previews must not create sessions, readings, or billing writes');
  assert.deepEqual(await page.evaluate(()=>({text:document.querySelector('#text').value,engine:document.querySelector('#engine').value,rate:document.querySelector('#rate').value,settings:localStorage.getItem('paste2speech.settings')})),initial);
  await page.route('**/voice-previews/en-US-Wavenet-F.mp3',route=>route.fulfill({status:404}));
  await buttons.nth(0).click();await page.waitForFunction(()=>document.querySelector('#voice-preview-status').textContent.includes('could not play'));
  await page.unroute('**/voice-previews/en-US-Wavenet-F.mp3');
  await buttons.nth(0).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#voice-preview-status').textContent.startsWith('Playing'));
  await page.keyboard.press('Enter');
  // Preview pauses a browser reading, preserving its word offset until explicit Resume.
  await page.click('#play');assert.equal(await page.locator('#status').textContent(),'Reading aloud');
  await buttons.nth(1).click();await page.waitForFunction(()=>document.querySelector('#voice-preview-status').textContent.startsWith('Playing'));
  assert.match(await page.locator('#status').textContent(),/Paused/);
  await buttons.nth(1).click();await page.click('#play');
  assert.equal(await page.evaluate(()=>__spoken.at(-1)),initial.text.slice(3));await page.click('#pause');
  await buttons.nth(0).click();await page.waitForFunction(()=>document.querySelector('#voice-preview-status').textContent.startsWith('Playing'));
  await page.locator('#voice-settings summary').first().click();await page.selectOption('#engine','google');
  assert.equal(await page.locator('.voice-discovery').isVisible(),false);
  assert.equal(await infoSummary.isVisible(),false);
  await page.selectOption('#engine','browser');assert.equal(await infoSummary.isVisible(),true);assert.equal(await info.evaluate(e=>e.open),true);
  await page.selectOption('#engine','google');assert.equal(await infoSummary.isVisible(),false);
  assert.equal(await page.locator('#voice-preview-panel').evaluate(e=>e.open),false);
  assert.equal(await page.evaluate(()=>__audio.some(a=>a.src.includes('/voice-previews/')&&!a.paused)),false);
  assert.equal(await page.locator('#voice').inputValue(),'en-US-Wavenet-F');
  assert.deepEqual(await page.locator('#voice optgroup').evaluateAll(es=>es.map(e=>e.label)),['US English','UK English']);
  assert.deepEqual(await page.locator('#voice option').evaluateAll(es=>es.map(e=>e.value)),WAVENET_VOICE_IDS);
  for(const voice of WAVENET_VOICES){
   await page.locator('#voice-settings').evaluate(e=>e.open=true);
   await page.selectOption('#voice',voice.id);assert.match(await page.locator('#voice-settings-summary').textContent(),new RegExp(voice.name));
   await page.reload();assert.equal(await page.locator('#voice').inputValue(),voice.id);
   assert.equal(await page.locator('.voice-discovery').isVisible(),false);
   assert.equal(await infoSummary.isVisible(),false);
  }
  assert.equal(mutations,0,'Changing/restoring paid voices must not create paid readings');
  await page.locator('#voice-settings').evaluate(e=>e.open=true);

  await page.waitForFunction(()=>document.querySelector('#upgrade-note').textContent.includes('Sign in'));
  config={account:{balance:0,verified:false},accessAllowed:false,eligible:false};await page.evaluate(()=>window.dispatchEvent(new Event('speech-credit-change')));await page.waitForFunction(()=>document.querySelector('#upgrade-note').textContent.includes('Verify your email'));
  config={account:{balance:0,verified:true},accessAllowed:true,eligible:false};await page.evaluate(()=>window.dispatchEvent(new Event('speech-credit-change')));await page.waitForFunction(()=>document.querySelector('#upgrade-note').textContent.includes('speech pack'));
  config={account:{balance:10000,verified:true},accessAllowed:true,eligible:true};await page.evaluate(()=>window.dispatchEvent(new Event('speech-credit-change')));await page.waitForFunction(()=>document.querySelector('#upgrade-note').textContent.includes('10,000'));
  await page.selectOption('#engine','browser');
  assert.equal(await infoSummary.isVisible(),true);assert.equal(await info.evaluate(e=>e.open),false);
  assert.equal(await page.locator('.voice-discovery').isVisible(),true);
  assert.equal(await page.locator('#voice-preview-panel').evaluate(e=>e.open),false);
  await page.locator('#voice-settings').evaluate(e=>e.open=false);
  await page.screenshot({path:`work/voice-previews/${environment}-mobile.png`,fullPage:true});
  await infoSummary.click();await page.screenshot({path:`work/voice-previews/${environment}-mobile-info.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile layout must not overflow');
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:`work/voice-previews/${environment}-desktop.png`,fullPage:true});
  assert.deepEqual(errors,[]);await context.close();console.log(`${environment}: voice preview and account states passed`);
 }
}finally{await browser.close();server.close();}
