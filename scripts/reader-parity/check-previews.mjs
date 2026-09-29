// Real browser checks; all account and reading calls are intercepted.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
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
  await page.addInitScript(()=>{const Original=window.Audio;window.__audio=[];window.Audio=function(...args){const audio=new Original(...args);window.__audio.push(audio);return audio;};});
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
  await page.locator('#voice-settings summary').first().click();await page.selectOption('#engine','google');
  await page.waitForFunction(()=>document.querySelector('#upgrade-note').textContent.includes('Sign in'));
  config={account:{balance:0,verified:false},accessAllowed:false,eligible:false};await page.evaluate(()=>window.dispatchEvent(new Event('speech-credit-change')));await page.waitForFunction(()=>document.querySelector('#upgrade-note').textContent.includes('Verify your email'));
  config={account:{balance:0,verified:true},accessAllowed:true,eligible:false};await page.evaluate(()=>window.dispatchEvent(new Event('speech-credit-change')));await page.waitForFunction(()=>document.querySelector('#upgrade-note').textContent.includes('speech pack'));
  config={account:{balance:10000,verified:true},accessAllowed:true,eligible:true};await page.evaluate(()=>window.dispatchEvent(new Event('speech-credit-change')));await page.waitForFunction(()=>document.querySelector('#upgrade-note').textContent.includes('10,000'));
  // Pause a real prepared reading and retain its position/source through preview.
  await buttons.nth(0).click();await page.waitForFunction(()=>document.querySelector('#voice-preview-status').textContent.startsWith('Playing'));
  await page.click('#play');assert.equal(await page.evaluate(()=>__audio.some(a=>a.src.includes('/voice-previews/')&&!a.paused)),false);try{await page.waitForFunction(()=>__audio.some(a=>a.src.startsWith('blob:')&&a.currentTime>.2),{},{timeout:10000});}catch(e){console.log(await page.locator('#status').textContent());console.log(await page.evaluate(()=>__audio.map(a=>({src:a.src,time:a.currentTime,error:a.error?.message}))));throw e;}
  const before=await page.evaluate(()=>{const a=__audio.find(a=>a.src.startsWith('blob:'));return {src:a.src,time:a.currentTime};});
  const writes=mutations;
  await buttons.nth(1).click();await page.waitForFunction(()=>document.querySelector('#voice-preview-status').textContent.startsWith('Playing'));
  const paused=await page.evaluate(()=>{const a=__audio.find(a=>a.src.startsWith('blob:'));return {src:a.src,time:a.currentTime,paused:a.paused};});
  assert.equal(paused.src,before.src);assert.ok(paused.time>=before.time);assert.ok(paused.paused);
  await buttons.nth(1).click();assert.equal(mutations,writes);
  await page.click('#play');await page.waitForFunction(()=>__audio.some(a=>a.src.startsWith('blob:')&&!a.paused));
  assert.equal(mutations,writes,'Resume after preview must reuse prepared audio');
  await page.click('#pause');
  await page.locator('#voice-settings').evaluate(e=>e.open=false);
  await page.screenshot({path:`work/voice-previews/${environment}-mobile.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile layout must not overflow');
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:`work/voice-previews/${environment}-desktop.png`,fullPage:true});
  assert.deepEqual(errors,[]);await context.close();console.log(`${environment}: voice preview and account states passed`);
 }
}finally{await browser.close();server.close();}
