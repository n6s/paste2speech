import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:412,height:915}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const wav=Buffer.alloc(44+48000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);
 let fail=false,calls=0;
 await page.route('**/api/audition/speech',async route=>{
  calls++;const payload=route.request().postDataJSON();assert.ok(payload.text.length<=2000);
  if(fail)return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({detail:'Cloudflare could not generate this sample.'})});
  await route.fulfill({status:200,contentType:'audio/wav',headers:{'X-Generation-Ms':'350'},body:wav});
 });
 await page.goto('http://127.0.0.1:8778/api/audition');
 assert.equal(await page.locator('section').count(),5);
 assert.equal(calls,0);
 const first=page.locator('section').nth(2);
 await first.getByRole('button').click();
 await first.locator('audio').waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelectorAll('audio')[2].duration===1);
 assert.equal(await first.locator('a').getAttribute('download'),'melo-en.wav');
 await first.locator('audio').evaluate(a=>a.play());
 const downloading=page.waitForEvent('download');await first.locator('a').click();const download=await downloading;assert.equal(download.suggestedFilename(),'melo-en.wav');
 for(const index of [0,1]){const card=page.locator('section').nth(index);await card.getByRole('button').click();await card.locator('audio').waitFor({state:'visible'});}
 assert.equal(await page.locator('audio:visible').count(),3);
 fail=true;await page.locator('section').nth(1).getByRole('button').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('could not generate'));
 assert.equal(await first.locator('a').isVisible(),true);
 await page.locator('#text').fill('');assert.equal(await first.getByRole('button').isDisabled(),true);
 await page.locator('#text').fill('A short audition.');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'work/audition-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Mobile layout, explicit generation, playback, download, error recovery passed.');
}finally{await browser.close();}
