import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const page=await browser.newPage();
await page.addInitScript(()=>{
 window.modelLoads=0;window.holdSetup=false;
 window.Worker=class {
  postMessage({id,type}) {
   if(type==='load')window.modelLoads++;
   if(window.holdSetup)return;
   this.timer=setTimeout(()=>this.onmessage({data:type==='benchmark'?{id,results:[{backend:'cpu',dtype:'q8',status:'ok',loadMs:10,firstMs:20,repeatMs:15,audioMs:100}]}:{id,ready:true,backend:'CPU · q8',fallback:false}}),40);
  }
  terminate(){clearTimeout(this.timer);}
 };
});
const ready=()=>page.waitForFunction(()=>document.querySelector('#download-status').textContent.includes('Kokoro is ready')&&!document.querySelector('#compare-gpu').disabled);
try {
 await page.goto('https://pop-os.tailbd091c.ts.net/speak/');
 await page.locator('#voice-settings > summary').click();
 assert.equal(await page.locator('#local-download').isVisible(),false);
 await page.locator('#engine').selectOption('kokoro');
 assert.equal(await page.evaluate(()=>window.modelLoads),0);
 assert.equal(await page.locator('#download-model').textContent(),'Download Kokoro');
 await page.locator('#download-model').click();await ready();
 assert.equal(await page.locator('#download-model').isVisible(),false);
 assert.equal(await page.evaluate(()=>window.modelLoads),1);
 await page.locator('#engine').selectOption('browser');await page.locator('#engine').selectOption('kokoro');
 assert.equal(await page.evaluate(()=>window.modelLoads),1);
 await page.reload();await ready();
 assert.equal(await page.locator('#engine').inputValue(),'kokoro');
 assert.equal(await page.evaluate(()=>window.modelLoads),1);
 await page.locator('#voice-settings > summary').click();
 await page.locator('#use-gpu').check();await ready();
 assert.equal(await page.evaluate(()=>window.modelLoads),2);
 await page.locator('#compare-gpu').click();await ready();
 assert.equal(await page.evaluate(()=>window.modelLoads),3);
 assert.equal(await page.locator('#download-model').isVisible(),false);
 await page.screenshot({path:'work/kokoro-ready.png',fullPage:true});
 await page.locator('#remove-model').click();
 await page.waitForFunction(()=>document.querySelector('#download-status').textContent.startsWith('Downloads removed.'));
 assert.equal(await page.locator('#download-model').isVisible(),true);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('paste2speech.settings')).kokoroEnabled),false);
 await page.evaluate(()=>window.holdSetup=true);
 await page.locator('#download-model').click();await page.locator('#cancel-download').click();
 await page.waitForFunction(()=>document.querySelector('#download-model').textContent==='Retry setup');
 await page.evaluate(()=>window.holdSetup=false);
 await page.locator('#download-model').click();await ready();
 await page.evaluate(()=>window.holdSetup=true);
 await page.locator('#use-gpu').uncheck();await page.locator('#engine').selectOption('browser');
 await page.waitForFunction(()=>document.querySelector('#cancel-download').hidden);
 assert.equal(await page.locator('#engine').inputValue(),'browser');
 console.log('First download, ready state, automatic reload/settings/comparison, removal, cancellation, and engine switching passed (mocked model).');
}finally{await browser.close();}
