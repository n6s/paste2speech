// Optional: npm install --no-save --package-lock=false playwright
// Start the README's local server first, then: node tests/browser.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('work', {recursive:true});
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true });
try {
 const context = await browser.newContext({ viewport: {width:393,height:851}, isMobile:true, deviceScaleFactor:1 });
 await context.addInitScript(() => {
  const synth = new EventTarget(); synth.spoken=[]; synth.cancel=()=>{};
  synth.getVoices=()=>[{name:'Test voice',lang:'en-US',voiceURI:'test',localService:true}];
  synth.speak=u=>synth.spoken.push(u);
  Object.defineProperty(window,'speechSynthesis',{value:synth});
  window.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
 });
 const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto(baseURL);
 assert.equal(await page.locator('#play').isDisabled(),true);
 await page.locator('#text').fill('# A moment to listen\n\n**Take a breath.** '+ 'This is a longer passage to read while taking a walk. '.repeat(18)+'\n\n```js\nnot spoken\n```\nciteturn0search0');
 assert.ok(!(await page.locator('#preview').textContent()).includes('not spoken'));
 await page.locator('#voice').selectOption('test');
 await page.locator('#play').click(); assert.equal(await page.locator('#status').textContent(),'Reading aloud');
 await page.evaluate(()=>speechSynthesis.spoken.at(-1).onend());
 assert.ok((await page.locator('#position').textContent()).startsWith('2 /'));
 await page.locator('#pause').click(); assert.equal(await page.locator('#play').textContent(),'▶ Resume');
 await page.locator('#play').click(); await page.locator('#stop').click();
 assert.equal(await page.locator('#status').textContent(),'Ready when you are');
 await page.locator('#play').click();
 await page.evaluate(()=>{let count=0;while(document.querySelector('#status').textContent==='Reading aloud' && count++<100)speechSynthesis.spoken.at(-1).onend();});
 assert.equal(await page.locator('#status').textContent(),'All read. Take a breath.');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'work/mobile.png',fullPage:true});
 await page.locator('#text').fill('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
 await page.locator('.paragraph').nth(1).click();
 assert.equal(await page.evaluate(()=>speechSynthesis.spoken.at(-1).text),'Second paragraph.');
 assert.equal(await page.locator('.paragraph[aria-current=true]').textContent(),'Second paragraph.');
 await page.evaluate(()=>{window.oldUtterance=speechSynthesis.spoken.at(-1);speechSynthesis.spoken.at(-1).onend();});
 assert.equal(await page.evaluate(()=>speechSynthesis.spoken.at(-1).text),'Third paragraph.');
 await page.locator('#pause').click();
 await page.locator('.paragraph').nth(0).focus(); await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>speechSynthesis.spoken.at(-1).text),'First paragraph.');
 await page.evaluate(()=>window.oldUtterance.onend());
 assert.equal(await page.locator('#position').textContent(),'1 / 3');
 await page.screenshot({path:'work/paragraphs-mobile.png',fullPage:true});
 await page.locator('#stop').click();
 assert.equal(await page.locator('.paragraph[aria-current=true]').count(),0);
 await page.reload(); assert.equal(await page.locator('#voice').inputValue(),'test'); assert.equal(await page.locator('#text').inputValue(),'');
 await page.locator('#text').fill('<img src=x onerror=alert(1)>');
 assert.equal(await page.locator('#preview img').count(),0);
 await page.locator('#clear').click(); assert.equal(await page.locator('#play').isDisabled(),true);
 await page.setViewportSize({width:1280,height:900}); await page.screenshot({path:'work/desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);
 const unsupported=await browser.newContext(); await unsupported.addInitScript(()=>{delete window.speechSynthesis;delete window.SpeechSynthesisUtterance;});
 const fallback=await unsupported.newPage(); await fallback.goto(baseURL);
 assert.ok((await fallback.locator('#status').textContent()).includes('unavailable'));
 console.log('Browser checks passed: mobile layout, cleanup, playback controls, sequential completion, persistence, safe preview, unsupported browser. Speech engine mocked; actual Pixel audio needs device testing.');
} finally { await browser.close(); }
