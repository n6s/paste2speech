import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const origin=process.env.MSE_PROOF_ORIGIN||'http://127.0.0.1:8790';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const results=[];
async function run(name,init,check){const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));try{if(init)await page.addInitScript(init);await page.goto(origin);await page.click('#start');await check(page,context);assert.deepEqual(errors,[]);results.push({name,passed:true});console.log('PASS '+name);}finally{await context.close();}}
try{
 await run('unsupported MSE offers explicit full comparison',()=>{MediaSource.isTypeSupported=()=>false;},async page=>{
  await page.waitForFunction(()=>proof.state==='failed');assert.match(await page.locator('#error').textContent(),/unavailable/);
  await page.selectOption('#mode','full');await page.click('#start');await page.waitForFunction(()=>proof.finalized);await page.waitForFunction(()=>proof.audio.currentTime>0);await page.click('#stop');
 });
 await run('quota failure remains explicit and does not finalize',()=>{SourceBuffer.prototype.appendBuffer=function(){throw new DOMException('Synthetic quota','QuotaExceededError');};},async page=>{
  await page.waitForFunction(()=>proof.state==='failed');assert.match(await page.locator('#error').textContent(),/buffer is full/);assert.equal(await page.evaluate(()=>proof.finalized),false);await page.click('#stop');
 });
 await run('stop during append ignores stale callbacks',()=>{const append=SourceBuffer.prototype.appendBuffer;SourceBuffer.prototype.appendBuffer=function(bytes){append.call(this,bytes);queueMicrotask(()=>window.proof.stop());};},async page=>{
  await page.waitForFunction(()=>proof.events.some(e=>e.type==='status'&&e.completed>0));await page.waitForTimeout(800);assert.equal(await page.evaluate(()=>proof.state),'idle');assert.equal(await page.evaluate(()=>proof.next),0);assert.equal(await page.evaluate(()=>proof.finalized),false);
 });
 await run('pause during preparation still appends every section',null,async page=>{
  await page.waitForFunction(()=>!!proof.job);await page.click('#pause');await page.waitForFunction(()=>proof.finalized);assert.equal(await page.evaluate(()=>proof.audio.paused),true);assert.equal(await page.evaluate(()=>proof.next),8);assert.equal(await page.evaluate(()=>proof.audio.currentTime),0);await page.click('#stop');
 });
 await run('bounded network retries then explicit resume reuse the same source',null,async(page,context)=>{
  await page.waitForFunction(()=>proof.next>=1);const source=await page.evaluate(()=>proof.audio.src);
  await context.setOffline(true);await page.waitForFunction(()=>proof.state==='disconnected',null,{timeout:12000});
  await context.setOffline(false);await page.click('#resume');await page.waitForFunction(()=>proof.finalized);assert.equal(await page.evaluate(()=>proof.audio.src),source);
  assert.deepEqual(await page.evaluate(()=>proof.events.filter(e=>e.type==='append').map(e=>e.index)),[0,1,2,3,4,5,6,7]);await page.click('#stop');
 });
 await run('duration discrepancy is exposed instead of corrected',null,async page=>{
  await page.route('**/api/readings/*',async route=>{
   if(route.request().method()!=='GET')return route.continue();
   const response=await route.fetch();const data=await response.json();if(data.state==='ready')data.duration+=.024;
   await route.fulfill({response,json:data});
  });
  await page.waitForFunction(()=>proof.state==='failed');assert.match(await page.locator('#error').textContent(),/no duration correction/);assert.equal(await page.evaluate(()=>proof.finalized),false);await page.click('#stop');
 });
 await writeFile('work/mse-reader-proof/results/lifecycle.json',JSON.stringify(results,null,2));
}finally{await browser.close();}
