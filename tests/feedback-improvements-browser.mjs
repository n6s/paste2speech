import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true});
 await context.addInitScript(()=>{
  localStorage.setItem('paste2speech.settings',JSON.stringify({readingSize:32,followReading:true,joinLines:false}));
  const synth=new EventTarget();synth.spoken=[];synth.cancel=()=>{};
  synth.getVoices=()=>[{name:'Test',lang:'en-US',voiceURI:'test',localService:true}];
  synth.speak=u=>synth.spoken.push(u);
  Object.defineProperty(window,'speechSynthesis',{value:synth});
  window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const submissions=[];
 await page.route('**/api/events',route=>route.fulfill({status:204}));
 await page.route('**/api/feedback-ticket',route=>route.fulfill({json:{id:'test',expires:1,signature:'test'}}));
 await page.route('**/api/feedback',route=>{submissions.push(route.request().postDataJSON());return route.fulfill({status:202,json:{saved:true}});});
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:8771/');
 await page.locator('#text').fill('A short opening.\n\n'+('The active chunk should remain readable at the selected large font size without clipping its highlighted lines ').repeat(4)+'.\n\nA short ending.');
 await page.locator('#read-mode').click();await page.locator('#play').click();
 const initial=await page.locator('#preview').evaluate(e=>e.clientHeight);
 await page.evaluate(()=>speechSynthesis.spoken.at(-1).onend());
 const dimensions=()=>page.evaluate(()=>{
  const pane=document.querySelector('#preview'),active=pane.querySelector('[aria-current=true]');
  const rects=[...active.getClientRects()],style=getComputedStyle(pane),bounds=pane.getBoundingClientRect();
  return {height:pane.clientHeight,chunk:rects.at(-1).bottom-rects[0].top,font:style.fontSize,
   inside:rects[0].top>=bounds.top-1&&rects.at(-1).bottom<=bounds.bottom+1};
 });
 let d=await dimensions();assert.ok(d.height>initial,JSON.stringify(d));assert.ok(d.height>d.chunk);assert.equal(d.font,'32px');assert.ok(d.inside);
 // Orientation/width changes refit the current chunk without advancing playback.
 const position=await page.locator('#position').textContent();
 await page.setViewportSize({width:320,height:740});
 await page.waitForFunction(()=>{const p=document.querySelector('#preview'),r=[...p.querySelector('[aria-current=true]').getClientRects()];return p.clientHeight>=r.at(-1).bottom-r[0].top+28;});
 assert.equal(await page.locator('#position').textContent(),position);
 const grown=await page.locator('#preview').evaluate(e=>e.clientHeight);
 await page.evaluate(()=>speechSynthesis.spoken.at(-1).onend());
 assert.equal(await page.locator('#preview').evaluate(e=>e.clientHeight),grown);
 // Growth works independently of Follow reading; font changes do not alter speech chunks.
 await page.locator('#follow-reading').uncheck();
 await page.locator('#preview').evaluate(e=>e.style.height='150px');
 await page.evaluate(()=>{const e=document.querySelectorAll('.sentence')[1];e.click();});
 await page.waitForFunction(()=>{const p=document.querySelector('#preview'),r=[...p.querySelector('[aria-current=true]').getClientRects()];return p.clientHeight>=r.at(-1).bottom-r[0].top+28;});
 assert.equal((await dimensions()).font,'32px');
 await page.locator('#reading-size-toggle').click();
 await page.locator('#reading-size').fill('24');
 assert.equal((await dimensions()).font,'24px');
 await page.locator('#reading-size-toggle').click();
 await page.locator('#preview').evaluate(e=>e.style.height='1800px');
 await page.waitForTimeout(50);assert.equal(await page.locator('#preview').evaluate(e=>e.clientHeight),1800);
 // Capture current cleanup state for every submission, not the initial preferences.
 await page.locator('#edit-mode').click();
 await page.locator('#voice-settings > summary').click();
 await page.getByText('Clean up before reading',{exact:true}).click();
 await page.locator('#clean-joinLines').check();await page.locator('#clean-emoji').check();
 await page.locator('#feedback > summary').click();
 await page.locator('[name=message]').fill('Browser fixture feedback without reading content.');
 await page.locator('#feedback-form button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#feedback-status').textContent.includes('Thank you'));
 assert.equal(submissions[0].context.cleanup.joinLines,true);assert.equal(submissions[0].context.cleanup.emoji,true);
 assert.equal(Object.keys(submissions[0].context.cleanup).length,7);
 assert.ok(!JSON.stringify(submissions[0]).includes('The active chunk'));
 await page.locator('#clean-joinLines').uncheck();
 await page.locator('[name=message]').fill('Second browser fixture with changed cleanup.');
 await page.locator('#feedback-form button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#feedback-status').textContent.includes('Thank you'));
 assert.equal(submissions[1].context.cleanup.joinLines,false);
 assert.deepEqual(errors,[]);
 console.log('Mobile viewport: chunk growth, orientation, font changes, manual size, follow off; current cleanup diagnostics and reading privacy passed.');
}finally{await browser.close();}
