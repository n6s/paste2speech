import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try {
 for(const privateHost of [false,true]) {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://pastetospeech.com/api/**',r=>r.fulfill({status:204,headers:{'access-control-allow-origin':'https://pop-os.tailbd091c.ts.net'}}));
  if(privateHost)await page.route('https://pop-os.tailbd091c.ts.net/speak/**',async route=>{
   const path=new URL(route.request().url()).pathname.slice('/speak/'.length);
   const response=await route.fetch({url:path.startsWith('api/')?'http://127.0.0.1:8766/'+path:'http://127.0.0.1:8777/'+path});await route.fulfill({response});
  });
  await page.goto(privateHost?'https://pop-os.tailbd091c.ts.net/speak/':'http://127.0.0.1:8777/');
  await page.locator('#voice-settings > summary').click();
  assert.equal(await page.locator('#engine option').count(),privateHost?4:2);
  assert.equal(await page.locator('#feedback-form textarea').count(),1);
  assert.equal(await page.locator('#download-model').count(),1);
  assert.ok((await page.locator('#pdf-status').textContent()).includes('not uploaded'));
  await page.locator('#engine').selectOption('kokoro');
  assert.equal(await page.locator('#voice option').count(),6);
  if(privateHost){
   await page.waitForFunction(()=>!document.querySelector('#engine option[value=workstation]').disabled);
   await page.locator('#engine').selectOption('workstation');
   await page.locator('#text').fill('This is the unified workstation reader.');await page.locator('#play').click();
   await page.waitForFunction(()=>['Reading aloud','All read. Take a breath.'].includes(document.querySelector('#status').textContent),{},{timeout:60000});
   await page.locator('#engine').selectOption('browser');
   await page.locator('#engine').selectOption('kokoro');
   assert.ok((await page.locator('#voice-note').textContent()).includes('on this device'));
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Unified public/private UI, engine switching, and real GPU playback passed.');
}finally{await browser.close();}
