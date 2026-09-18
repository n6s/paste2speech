import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:412,height:915}});
await context.addInitScript(()=>{
 const original=URL.createObjectURL.bind(URL);
 URL.createObjectURL=blob=>{if(blob.type==='audio/wav')window.qaAudio=blob;return original(blob);};
});
const page=await context.newPage();
const errors=[];const readingRequests=[];
page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});
page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,300))});
page.on('request',r=>{if(r.method()==='POST')readingRequests.push({url:r.url(),data:r.postData()});});
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:8777/');
 await page.locator('#text').fill('Waymo demos UBTECH robotaxi and robotaxis.');
 await page.locator('#text').dispatchEvent('input');
 await page.locator('#read-mode').click();
 assert.equal(await page.locator('#status').textContent(),'Ready when you are');
 await page.locator('#voice-settings > summary').click();
 await page.locator('#engine').selectOption('kokoro');
 await page.locator('#download-model').click();
 await page.waitForFunction(()=>document.querySelector('#download-status').textContent.includes('Kokoro is ready'),{},{timeout:300000});
 console.log('Model loaded');
 await page.locator('#play').click();
 await page.waitForFunction(()=>['Reading aloud','All read. Take a breath.'].includes(document.querySelector('#status').textContent),{},{timeout:300000});
 console.log('Real synthesis and playback passed');
 await page.locator('#pause').click().catch(()=>{});
 await mkdir('work',{recursive:true});
 await page.screenshot({path:'work/public-preview.png',fullPage:true});
 // Generated WAV is accessible only in memory; save a short QA sample locally.
 const wav=await page.evaluate(async()=>[...new Uint8Array(await window.qaAudio.arrayBuffer())]);
 await writeFile('work/browser-heart.wav',Buffer.from(wav));
 await page.locator('#voice').selectOption('bm_george');
 await page.locator('#play').click();
 await page.waitForFunction(()=>['Reading aloud','All read. Take a breath.'].includes(document.querySelector('#status').textContent),{},{timeout:300000});
 const british=await page.evaluate(async()=>[...new Uint8Array(await window.qaAudio.arrayBuffer())]);
 await writeFile('work/browser-george.wav',Buffer.from(british));
 assert.ok(british.length>48000);
 await page.locator('#stop').click();
 await page.locator('#remove-model').click();
 await page.waitForFunction(()=>document.querySelector('#download-status').textContent.startsWith('Downloads removed.'));
 assert.equal(await page.locator('#engine').inputValue(),'kokoro');
 assert.equal(await page.locator('#download-model').textContent(),'Download Kokoro');
 assert.equal(await page.evaluate(async()=>{let n=0;for(const key of await caches.keys())for(const r of await (await caches.open(key)).keys())if(r.url.includes('Kokoro-82M'))n++;return n;}),0);
 assert.ok(!readingRequests.some(r=>r.url.includes('/speech')||r.url.includes('/pdf-text')));
 assert.deepEqual(errors,[]);
 console.log('Public UI, local processing and no page errors verified');
}catch(e){await page.screenshot({path:'work/public-failure.png',fullPage:true});console.log('STATUS',await page.locator('#status').textContent(),await page.locator('#download-status').textContent());throw e;}
finally{await browser.close();}
