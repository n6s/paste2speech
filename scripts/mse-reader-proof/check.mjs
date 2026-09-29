// Actual Chromium + local Worker integration. Never calls a speech provider.
import {chromium,request} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import fixtures from '../wavenet-worker-proof/fixture.json' with {type:'json'};
const origin=process.env.MSE_PROOF_ORIGIN||'http://127.0.0.1:8790';
const root='work/mse-reader-proof/results';await mkdir(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const records=[];
async function pageFor(){const context=await browser.newContext();const page=await context.newPage();page.on('pageerror',e=>records.push({pageError:e.message}));await page.goto(origin);return {context,page};}
async function start(page,{voice='en-US-Wavenet-F',concurrency=3,scenario='normal',mode='mse'}={}){
 await page.selectOption('#voice',voice);await page.selectOption('#concurrency',String(concurrency));await page.selectOption('#scenario',scenario);await page.selectOption('#mode',mode);await page.click('#start');
}
async function finish(page){await page.waitForFunction(()=>proof.finalized||proof.state==='failed',null,{timeout:45000});assert.equal(await page.evaluate(()=>proof.error),'');}
async function save(page,name){const report=await page.evaluate(()=>proof.diagnostics());await writeFile(`${root}/${name}.json`,JSON.stringify(report,null,2));records.push({name,state:report.state,duration:report.status?.duration});return report;}
async function standard(voice,concurrency){
 const {context,page}=await pageFor();const name=`${voice}-${concurrency}`;
 await start(page,{voice,concurrency});await page.waitForFunction(()=>proof.audio.currentTime>.1);
 const source=await page.evaluate(()=>proof.audio.src);
 await page.click('#pause');const position=await page.evaluate(()=>proof.audio.currentTime);
 await page.waitForTimeout(350);assert.ok(Math.abs(await page.evaluate(()=>proof.audio.currentTime)-position)<.02);
 await page.selectOption('#rate','2');await page.click('#resume');await finish(page);
 assert.equal(await page.evaluate(()=>proof.audio.src),source);
 const initial=await page.evaluate(()=>proof.diagnostics());const appended=initial.events.filter(e=>e.type==='append');
 assert.deepEqual(appended.map(e=>e.index),[0,1,2,3,4,5,6,7]);
 for(let i=0;i<appended.length;i++)assert.ok(Math.abs(appended[i].ranges.at(-1)[1]-(i===7?initial.status.duration:initial.status.starts[i+1]))<.0001);
 const pre=initial.events.find(e=>e.type==='before-end-of-stream');assert.equal(pre.bufferedEnd,initial.status.duration,'unforced buffered timeline matches frame count');
 assert.ok(initial.events.find(e=>e.type==='playing').ms<initial.events.find(e=>e.type==='end-of-stream').ms);
 // Traverse every section naturally, so final time is not only a seek result.
 await page.waitForFunction(()=>proof.state==='done',null,{timeout:30000});
 assert.ok(Math.abs(await page.evaluate(()=>proof.audio.currentTime)-initial.status.duration)<.0001);
 assert.equal(await page.evaluate(()=>proof.events.filter(e=>e.type==='loadstart').length),1);
 await page.click('#resume');await page.waitForFunction(()=>proof.audio.currentTime>.1&&!proof.audio.paused);
 await page.click('#pause');
 for(const time of [initial.status.starts[3]+.2,initial.status.starts[7]+.1,initial.status.starts[1]+.2,0]){
  assert.equal(await page.evaluate(t=>proof.seek(t),time),true);await page.waitForFunction(t=>Math.abs(proof.audio.currentTime-t)<.01,time);
  const index=await page.evaluate(()=>proof.index);assert.equal(index,Math.max(0,initial.status.starts.findLastIndex(t=>t<=time)));
 }
 const id=await page.evaluate(()=>proof.job);
 const mp3=await context.request.get(`${origin}/api/readings/${id}/download/mp3`);assert.equal(mp3.status(),200);
 const expected=Buffer.concat(await Promise.all(fixtures[voice].map(s=>readFile(`tests/fixtures/wavenet/${s.file}`))));assert.deepEqual(await mp3.body(),expected);
 const vtt=await context.request.get(`${origin}/api/readings/${id}/download/vtt`);assert.equal((await vtt.text()).match(/ --> /g).length,8);
 const foreign=await request.newContext({baseURL:origin});await foreign.post('/api/session',{headers:{Origin:origin}});
 assert.equal((await foreign.get(`/api/readings/${id}/sections/0`)).status(),404);await foreign.dispose();
 const partial=await context.request.get(`${origin}/api/readings/${id}/audio`,{headers:{Range:'bytes=0-191'}});assert.equal(partial.status(),206);assert.equal((await partial.body()).length,192);
 assert.equal((await context.request.get(`${origin}/api/readings/${id}/audio`,{headers:{Range:'bytes=99999999-'}})).status(),416);
 await save(page,name);await page.click('#stop');await context.close();console.log(`PASS ${name}: early playback, natural end, replay, seeks, exports, ownership`);
}
async function scenarios(){
 const {context,page}=await pageFor();
 await start(page,{scenario:'out-of-order'});await finish(page);assert.deepEqual(await page.evaluate(()=>proof.events.filter(e=>e.type==='append').map(e=>e.index)),[0,1,2,3,4,5,6,7]);await save(page,'out-of-order');
 await start(page,{scenario:'stalled'});await page.waitForFunction(()=>proof.audio.currentTime>1);await page.selectOption('#rate','2');
 await page.waitForFunction(()=>proof.state==='buffering'&&proof.audio.currentTime>3,null,{timeout:15000});await finish(page);
 await page.waitForFunction(()=>proof.audio.currentTime>5.5);await save(page,'starvation-recovered');
 await start(page,{scenario:'failure'});await page.waitForFunction(()=>proof.state==='failed');assert.equal(await page.evaluate(()=>proof.finalized),false);await save(page,'failure');
 await start(page,{scenario:'stalled'});await page.waitForFunction(()=>proof.next===1);const id=await page.evaluate(()=>proof.job);await page.click('#stop');await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>proof.next),0);assert.equal((await context.request.get(`${origin}/api/readings/${id}`)).status(),410);
 // Read interruption: preserve the media source and resume missing sections.
 await start(page,{concurrency:1});await page.waitForFunction(()=>proof.next===1);const src=await page.evaluate(()=>proof.audio.src);
 await context.setOffline(true);await page.waitForTimeout(1200);await context.setOffline(false);await finish(page);assert.equal(await page.evaluate(()=>proof.audio.src),src);await save(page,'connection-recovered');
 await start(page,{mode:'full'});await finish(page);await page.waitForFunction(()=>proof.audio.readyState>=2);
 const full=await page.evaluate(()=>({duration:proof.audio.duration,expected:proof.status.duration}));assert.ok(Math.abs(full.duration-full.expected)<.0001);await save(page,'full-comparison');
 // Cancellation while section body is still in flight must never append later.
 await page.route('**/sections/0',async route=>{await new Promise(r=>setTimeout(r,1000));await route.continue().catch(()=>{});});
 await start(page);await page.waitForFunction(()=>proof.status?.completed>0);await page.click('#stop');await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>proof.next),0);
 await page.unroute('**/sections/0');await context.close();console.log('PASS fault, buffering, reconnect, comparison and cancellation scenarios');
}
try{
 await Promise.all([standard('en-US-Wavenet-F',3),standard('en-US-Wavenet-F',1),standard('en-GB-Wavenet-F',3),standard('en-GB-Wavenet-F',1),scenarios()]);
 assert.equal(records.some(r=>r.pageError),false,JSON.stringify(records));
 const api=await request.newContext({baseURL:origin});assert.equal((await api.get('/api/readings/00000000-0000-0000-0000-000000000000')).status(),401);
 await api.post('/api/session',{headers:{Origin:origin}});
 assert.equal((await api.post('/api/readings',{headers:{Origin:origin},data:{voice:'en-US-Wavenet-F',scenario:'normal',concurrency:3,mode:'live'}})).status(),422);
 assert.equal((await api.post('/api/readings',{headers:{Origin:'https://untrusted.invalid'},data:{}})).status(),403);await api.dispose();
 await writeFile(`${root}/summary.json`,JSON.stringify({passed:true,origin,browser:browser.version(),records},null,2));console.log('All MSE browser and Worker checks passed.');
}finally{await browser.close();}
