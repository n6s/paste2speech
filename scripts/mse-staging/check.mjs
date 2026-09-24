// Cached-only normal-reader integration checks. Never enables paid synthesis.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
const origin=process.env.MSE_STAGING_ORIGIN||'http://127.0.0.1:8791';
if(!['http://127.0.0.1:8791','https://speak-staging.rogerpbrown.com'].includes(origin))throw Error('Only isolated local or private staging is allowed');
const remote=origin.startsWith('https:');
const cookies=remote?[{name:'CF_Authorization',value:execFileSync('cloudflared',['access','token','--app',origin],{encoding:'utf8'}).trim(),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]:[];
const root=`work/mse-staging/${remote?'remote':'local'}-checks`;await mkdir(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});const results=[];
async function create(init){const context=await browser.newContext();await context.addCookies(cookies);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));if(init)await page.addInitScript(init);await page.goto(origin+'/?testing=1');await page.waitForFunction(()=>window.__stagingReader);await page.locator('#voice-settings').evaluate(e=>e.open=true);await page.locator('#staging-checks').evaluate(e=>e.open=true);await page.selectOption('#engine','google');assert.equal(await page.locator('#playback-options').evaluate(e=>e.open),false);assert.equal(await page.locator('#mse-delivery').isVisible(),false);await page.locator('#playback-options summary').click();return {context,page,errors};}
async function start(page,{voice='en-US-Wavenet-F',concurrency=3,scenario='normal',delivery='mse'}={}){
 await page.selectOption('#voice',voice);await page.check('#mse-cached');await page.selectOption('#mse-concurrency',String(concurrency));await page.selectOption('#mse-scenario',scenario);await page.selectOption('#mse-delivery',delivery);
 await page.click('#mse-sample');await page.waitForFunction(()=>document.querySelector('#preview .sentence'));await page.click('#play');
}
async function finish(page,timeout=45000){await page.waitForFunction(()=>__stagingReader.finalized||__stagingReader.state==='failed',null,{timeout});assert.equal(await page.evaluate(()=>__stagingReader.error),'');}
async function record(page,name){const d=await page.evaluate(()=>__stagingReader.diagnostics());await writeFile(`${root}/${name}.json`,JSON.stringify(d,null,2));results.push({name,passed:true,state:d.state,duration:d.status?.duration,job:d.status?.id});console.log('PASS '+name);return d;}
async function run(name,check,init){if(process.env.MSE_CHECK_ONLY&&!new RegExp(process.env.MSE_CHECK_ONLY).test(name))return;const {context,page,errors}=await create(init);try{await check(page,context);assert.deepEqual(errors,[]);await record(page,name);}catch(error){await record(page,name+'-FAILED');throw error;}finally{await context.close();}}
try{
 for(const voice of Object.keys(fixtures))for(const concurrency of [1,3])await run(`${voice}-${concurrency}`,async(page,context)=>{
  await start(page,{voice,concurrency});await page.waitForFunction(()=>__stagingReader.audio.currentTime>.1);const source=await page.evaluate(()=>__stagingReader.audio.src);
  await page.click('#pause');assert.equal(await page.evaluate(()=>navigator.mediaSession.playbackState),'paused');const pos=await page.evaluate(()=>__stagingReader.audio.currentTime);await page.waitForTimeout(300);assert.ok(Math.abs(await page.evaluate(()=>__stagingReader.audio.currentTime)-pos)<.02);
  await page.locator('#rate').fill('2');await page.locator('#rate').dispatchEvent('input');await page.click('#play');await finish(page);
  const d=await page.evaluate(()=>__stagingReader.diagnostics());assert.deepEqual(d.events.filter(e=>e.type==='append').map(e=>e.index),[0,1,2,3,4,5,6,7]);
  for(const a of d.events.filter(e=>e.type==='append'))assert.ok(Math.abs(a.ranges.at(-1)[1]-(d.status.starts[a.index+1]??d.status.duration))<1/24000);
  assert.equal(d.events.find(e=>e.type==='before-end-of-stream').bufferedEnd,d.status.duration);assert.ok(d.events.find(e=>e.type==='playing').ms<d.events.find(e=>e.type==='end-of-stream').ms);
  await page.waitForFunction(()=>__stagingReader.state==='done',null,{timeout:30000});assert.equal(await page.evaluate(()=>__stagingReader.audio.src),source);assert.equal(await page.evaluate(()=>__stagingReader.events.filter(e=>e.type==='loadstart').length),1);
  await page.click('#play');await page.waitForFunction(()=>__stagingReader.audio.currentTime>.1&&!__stagingReader.audio.paused);await page.click('#pause');
  for(const t of [d.status.starts[3]+.2,d.status.starts[7]+.1,0]){await page.locator('#seek').evaluate((e,t)=>{e.value=t;e.dispatchEvent(new Event('input',{bubbles:true}));},t);await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>__stagingReader.index),Math.max(0,d.status.starts.findLastIndex(s=>s<=t)));assert.equal(await page.locator('#preview [aria-current=true]').count(),1);}
  const id=d.status.id;const expected=Buffer.concat(await Promise.all(fixtures[voice].map(s=>readFile(`tests/fixtures/wavenet/${s.file}`))));assert.deepEqual(await (await context.request.get(`${origin}/api/readings/${id}/download/mp3`)).body(),expected);
  assert.equal((await (await context.request.get(`${origin}/api/readings/${id}/download/vtt`)).text()).match(/ --> /g).length,8);
  const foreign=await browser.newContext();await foreign.addCookies(cookies);await foreign.request.post(`${origin}/api/billing/session`,{headers:{Origin:origin},data:{}});assert.equal((await foreign.request.get(`${origin}/api/readings/${id}/sections/0`)).status(),404);await foreign.close();
  const before=await page.evaluate(()=>__stagingReader.job);await page.click('#mse-fallback');await page.waitForFunction(()=>__stagingReader.mode==='full'&&__stagingReader.finalized&&Number.isFinite(__stagingReader.audio.duration));assert.equal(await page.evaluate(()=>__stagingReader.job),before);assert.ok(Math.abs(await page.evaluate(()=>__stagingReader.audio.duration)-d.status.duration)<1/24000);
 });
 await run('API identity and ownership',async(page,context)=>{
  await context.request.post(`${origin}/api/billing/session`,{headers:{Origin:origin},data:{}});
  const id=crypto.randomUUID(),data={voice:'en-US-Wavenet-F',chunks:fixtures['en-US-Wavenet-F'].map(s=>s.text),mseOptions:{delivery:'mse',concurrency:1,cached:true,scenario:'stalled'}};
  const headers={Origin:origin,'Idempotency-Key':id};
  assert.equal((await context.request.post(`${origin}/api/readings`,{headers,data})).status(),201);
  const duplicate=await context.request.post(`${origin}/api/readings`,{headers,data});assert.equal(duplicate.status(),200);assert.equal((await duplicate.json()).reused,true);
  assert.equal((await context.request.post(`${origin}/api/readings`,{headers,data:{...data,mseOptions:{...data.mseOptions,concurrency:3}}})).status(),409);
  assert.equal((await context.request.get(`${origin}/api/readings/${id}/sections/1`)).status(),409);
  assert.equal((await context.request.get(`${origin}/api/readings/${id}/sections/999`)).status(),404);
  assert.equal((await context.request.delete(`${origin}/api/readings/${id}`,{headers:{Origin:'https://example.com'}})).status(),403);
  await page.waitForTimeout(1500);assert.equal((await context.request.get(`${origin}/api/readings/${id}/sections/0`)).status(),200);
  assert.equal((await context.request.delete(`${origin}/api/readings/${id}`,{headers:{Origin:origin}})).status(),204);
  assert.equal((await context.request.get(`${origin}/api/readings/${id}/sections/0`)).status(),404);
  const unauth=await browser.newContext();const denied=await unauth.request.get(`${origin}/api/readings/${id}/sections/0`,{maxRedirects:0});assert.ok([302,401,403,404].includes(denied.status()));await unauth.close();
 });
 await run('full-preparation-controls',async page=>{
  await start(page,{delivery:'complete'});await finish(page);await page.waitForFunction(()=>__stagingReader.audio.currentTime>0);await page.click('#pause');
  const id=await page.evaluate(()=>__stagingReader.job);
  await page.evaluate(()=>{__stagingReader.ranges=()=>[];if(!__stagingReader.seekTo(30))throw Error('Completed-file seek must request unbuffered data');});
  await page.waitForFunction(()=>__stagingReader.audio.currentTime>=30);await page.locator('#preview .sentence').nth(2).click();await page.waitForFunction(()=>__stagingReader.state==='playing'&&__stagingReader.index===2);assert.equal(await page.evaluate(()=>__stagingReader.job),id);
 });
 await run('selected-section-start',async page=>{
  await page.check('#mse-cached');await page.click('#mse-sample');await page.waitForFunction(()=>document.querySelectorAll('#preview .sentence').length===8);await page.click('#read-mode');await page.locator('#preview .sentence').nth(4).click();
  await page.waitForFunction(()=>__stagingReader.state==='playing');assert.equal(await page.evaluate(()=>__stagingReader.index),4);await finish(page);
 });
 await run('out-of-order',async page=>{await start(page,{scenario:'out-of-order'});await finish(page);assert.deepEqual(await page.evaluate(()=>__stagingReader.events.filter(e=>e.type==='append').map(e=>e.index)),[0,1,2,3,4,5,6,7]);});
 await run('starvation-recovery',async page=>{await start(page,{scenario:'stalled'});await page.waitForFunction(()=>__stagingReader.audio.currentTime>1);await page.evaluate(()=>__stagingReader.setRate(2));await page.waitForFunction(()=>__stagingReader.state==='buffering'&&__stagingReader.audio.currentTime>3);await finish(page);await page.waitForFunction(()=>__stagingReader.audio.currentTime>6);});
 await run('failure',async page=>{await start(page,{scenario:'failure'});await page.waitForFunction(()=>__stagingReader.state==='failed');assert.equal(await page.evaluate(()=>__stagingReader.finalized),false);});
 await run('cancel-late-create',async(page,context)=>{
  let created;
  await page.route('**/api/readings',async route=>{const response=await route.fetch();created=await response.json();await new Promise(r=>setTimeout(r,1200));await route.fulfill({response});});
  await start(page);await page.waitForFunction(()=>__stagingReader.state==='preparing');await page.click('#stop');await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(()=>__stagingReader.state),'idle');assert.equal(await page.evaluate(()=>__stagingReader.job),null);assert.ok(created?.id);assert.equal((await context.request.get(`${origin}/api/readings/${created.id}`)).status(),404);
 });
 await run('cancel-fetch',async(page,context)=>{await page.route('**/sections/0',async route=>{await new Promise(r=>setTimeout(r,800));await route.continue().catch(()=>{});});await start(page);await page.waitForFunction(()=>__stagingReader.status?.completed>0);const id=await page.evaluate(()=>__stagingReader.job);await page.click('#stop');await page.waitForTimeout(1300);assert.equal(await page.evaluate(()=>__stagingReader.next),0);assert.equal((await context.request.get(`${origin}/api/readings/${id}`)).status(),404);});
 await run('cancel-append',async page=>{await start(page);await page.waitForTimeout(3000);assert.equal(await page.evaluate(()=>__stagingReader.state),'idle');assert.equal(await page.evaluate(()=>__stagingReader.next),0);},()=>{const append=SourceBuffer.prototype.appendBuffer;SourceBuffer.prototype.appendBuffer=function(b){append.call(this,b);queueMicrotask(()=>window.__stagingReader.stop());};});
 await run('paused-buffering',async page=>{await start(page);await page.waitForFunction(()=>!!__stagingReader.job);await page.click('#pause');await finish(page);assert.equal(await page.evaluate(()=>__stagingReader.audio.paused),true);assert.equal(await page.evaluate(()=>__stagingReader.next),8);});
 await run('bounded-disconnection-resume',async(page,context)=>{await start(page,{concurrency:1});await page.waitForFunction(()=>__stagingReader.next===1);const src=await page.evaluate(()=>__stagingReader.audio.src);const job=await page.evaluate(()=>__stagingReader.job);await context.setOffline(true);await page.waitForFunction(()=>__stagingReader.state==='disconnected',null,{timeout:15000});await context.setOffline(false);await page.click('#play');await finish(page);assert.equal(await page.evaluate(()=>__stagingReader.audio.src),src);assert.equal(await page.evaluate(()=>__stagingReader.job),job);assert.deepEqual(await page.evaluate(()=>__stagingReader.events.filter(e=>e.type==='append').map(e=>e.index)),[0,1,2,3,4,5,6,7]);});
 await run('unsupported-before-create',async page=>{assert.equal(await page.locator('#mse-delivery').inputValue(),'complete');await start(page,{delivery:'complete'});await finish(page);assert.equal(await page.evaluate(()=>__stagingReader.mode),'full');},()=>{MediaSource.isTypeSupported=()=>false;});
 await run('quota-explicit-failure',async page=>{await start(page);await page.waitForFunction(()=>__stagingReader.state==='failed');assert.match(await page.evaluate(()=>__stagingReader.error),/buffer is full/);assert.equal(await page.evaluate(()=>__stagingReader.finalized),false);},()=>{SourceBuffer.prototype.appendBuffer=function(){throw new DOMException('Synthetic quota','QuotaExceededError');};});
 if(process.env.MSE_CHECK_LONG==='1')await run('long-64-sections',async page=>{
  await start(page,{scenario:'long'});await page.waitForFunction(()=>__stagingReader.audio.currentTime>0);const source=await page.evaluate(()=>__stagingReader.audio.src);
  await finish(page,240000);assert.equal(await page.evaluate(()=>__stagingReader.next),64);assert.equal(await page.evaluate(()=>__stagingReader.audio.src),source);
  await page.waitForFunction(()=>__stagingReader.state==='done',null,{timeout:200000});assert.equal(await page.evaluate(()=>__stagingReader.events.filter(e=>e.type==='loadstart').length),1);
 });
 await run('24ms-guard',async page=>{await page.route('**/api/readings/*',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();const data=await response.json();if(data.state==='ready')data.duration+=.024;await route.fulfill({response,json:data});});await start(page);await page.waitForFunction(()=>__stagingReader.state==='failed');assert.match(await page.evaluate(()=>__stagingReader.error),/no duration correction/);assert.equal(await page.evaluate(()=>__stagingReader.finalized),false);});
}finally{await writeFile(`${root}/summary.json`,JSON.stringify(results,null,2));await browser.close();}
