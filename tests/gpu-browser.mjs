import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const page=await browser.newPage();
try {
 await page.goto(process.env.TEST_URL||'https://pop-os.tailbd091c.ts.net/speak/');
 await page.locator('#voice-settings > summary').click();
 await page.locator('#engine').selectOption('kokoro');
 assert.equal(await page.locator('#gpu-experiment').isVisible(),true);
 await page.locator('#use-gpu').check();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('paste2speech.settings')).useGPU),true);
 await page.reload();
 assert.equal(await page.locator('#use-gpu').isChecked(),true);
 // Force only capability detection unavailable; run the actual model and synthesis.
 await page.route('**/kokoro-worker.js',async route=>{
  const response=await route.fetch();
  await route.fulfill({response,body:"Object.defineProperty(self.navigator,'gpu',{value:undefined});\n"+await response.text()});
 });
 await page.locator('#voice-settings > summary').click();
 await page.locator('#engine').selectOption('kokoro');
 await page.locator('#download-model').click();
 await page.waitForFunction(()=>document.querySelector('#download-status').textContent.includes('GPU unavailable; using CPU'),null,{timeout:300000});
 assert.equal(await page.locator('#download-model').isVisible(),false);
 const audio=await page.evaluate(async()=>{
  const worker=new Worker(new URL('kokoro-worker.js',location.href),{type:'module'});
  try {
   return await new Promise((resolve,reject)=>{
    worker.onmessage=({data})=>{if(data.error)reject(Error(data.error));else if(data.pcm)resolve({bytes:data.pcm.byteLength,backend:data.backend,fallback:data.fallback,metrics:data.metrics});};
    worker.onerror=reject;
    worker.postMessage({id:1,type:'synthesize',text:'Nap from 3:00–5:00 PM. Use a 1:2 ratio.',voice:'af_heart',speed:1,useGPU:true});
   });
  }finally{worker.terminate();}
 });
 assert.ok(audio.bytes>4800);assert.equal(audio.backend,'CPU · q8');assert.equal(audio.fallback,true);assert.ok(audio.metrics.generateMs>0);assert.ok(audio.metrics.audioMs>0);assert.equal(audio.metrics.characters,'Nap from 3:00–5:00 PM. Use a 1:2 ratio.'.length);
 await page.locator('#compare-gpu').click();
 await page.locator('#cancel-download').click();
 await page.waitForFunction(()=>document.querySelector('#gpu-results').textContent==='Comparison cancelled.');
 assert.equal(await page.locator('#download-model').textContent(),'Retry setup');
 assert.equal(await page.locator('#download-model').isVisible(),true);
 let submitted;
 await page.route('**/api/feedback-ticket',route=>route.fulfill({json:{id:'test'}}));
 await page.route('**/api/feedback',async route=>{submitted=route.request().postDataJSON();await route.fulfill({status:202,json:{saved:true}});});
 await page.locator('#feedback > summary').click();
 await page.locator('[name=message]').fill('Local intercepted metrics report.');
 await page.locator('#feedback-form button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#feedback-status').textContent.includes('saved'));
 assert.equal(submitted.context.processing.requestedGPU,true);
 assert.equal(submitted.context.processing.last,undefined);
 assert.equal(submitted.context.processing.chunks,0);
 assert.equal(submitted.context.processing.operation.status,'cancelled');
 console.log('GPU preference persistence, real CPU fallback synthesis, comparison cancellation passed');
}finally{await browser.close();}
