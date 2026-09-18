import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage();
await page.addInitScript(()=>{
 window.Worker=class {
  postMessage({id,type,text}){this.timer=setTimeout(()=>{
   const data={id,backend:'GPU · fp32',fallback:false,metrics:{status:'ok',backend:'gpu',dtype:'fp32',fallback:false}};
   if(type==='synthesize'){data.pcm=new Int16Array(2400).fill(100).buffer;Object.assign(data.metrics,{generateMs:30,audioMs:100,characters:text.length});}
   else {data.ready=true;Object.assign(data.metrics,{loadMs:20,probeMs:10});}
   this.onmessage({data});
  },10);}
  terminate(){clearTimeout(this.timer);}
 };
});
let report;
await page.route('**/api/feedback-ticket',r=>r.fulfill({json:{id:'intercepted'}}));
await page.route('**/api/feedback',async r=>{report=r.request().postDataJSON();await r.fulfill({status:202,json:{saved:true}});});
async function feedback(){
 await page.locator('[name=message]').fill('Intercepted attribution regression check.');
 await page.locator('#feedback-form button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#feedback-status').textContent.includes('saved'));
 return report.context;
}
try {
 await page.goto('https://pop-os.tailbd091c.ts.net/speak/');
 await page.locator('#voice-settings > summary').click();await page.locator('#engine').selectOption('kokoro');await page.locator('#download-model').click();
 await page.waitForFunction(()=>document.querySelector('#download-status').textContent.includes('Kokoro is ready'));
 await page.locator('#text').fill('First reading.');await page.locator('#play').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='All read. Take a breath.');
 await page.locator('#feedback > summary').click();
 const initial=await feedback();assert.equal(initial.processing.version,2);assert.equal(initial.processing.chunks,1);assert.equal(initial.processing.last.backend,'gpu');assert.equal(initial.processing.last.loadMs,undefined);
 await page.locator('#edit-mode').click();
 await page.locator('#text').fill('Different reading.');
 const changed=await feedback();assert.equal(changed.processing.chunks,0);assert.equal(changed.processing.last,undefined);
 await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='All read. Take a breath.');
 await page.locator('#voice').selectOption('am_fenrir');assert.equal((await feedback()).processing.chunks,0);
 await page.locator('#engine').selectOption('workstation');assert.equal((await feedback()).processing,undefined);
 await page.locator('#engine').selectOption('browser');assert.equal((await feedback()).processing,undefined);
 await page.locator('#engine').selectOption('kokoro');assert.equal((await feedback()).processing.chunks,0);
 console.log('Feedback metrics follow current text, voice, and engine; older GPU data does not leak into workstation/browser reports.');
}finally{await browser.close();}
