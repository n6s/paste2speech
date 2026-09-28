import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin='https://pastetospeech.com';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
try{
 const page=await browser.newPage({viewport:{width:393,height:851}}),errors=[],external=[],mutations=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url());if(u.origin!==origin){external.push(u.origin);return route.abort();}
  if(r.method()!=='GET')mutations.push(u.pathname);
  const status={emailConfigured:false,email:null,account:null,usage:[],month:'2026-09',trial:true,configured:false};
  if(u.pathname==='/api/reader')return route.fulfill({json:{account:null,eligible:false,liveEnabled:false,voices:['en-US-Wavenet-F','en-GB-Wavenet-F']}});
  if(u.pathname==='/api/billing/status')return route.fulfill({json:status});
  if(u.pathname==='/api/events')return route.fulfill({status:204});
  const paths={'/':'index.html','/api/billing':'billing.html','/api/billing/app.js':'billing.js'};
  const name=paths[u.pathname]||u.pathname.slice(1);assert.ok(!name.includes('..'));
  try{const body=await readFile('work/production-reader/site/'+name);return route.fulfill({body,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});}catch{return route.fulfill({status:404});}
 });
 await page.addInitScript(()=>{window.__spoken=0;Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[{name:'Test voice',lang:'en-US',default:true,localService:true}],cancel(){},pause(){},resume(){},addEventListener(){},speak(utterance){window.__spoken++;setTimeout(()=>utterance.onend?.(),10);}}});});
 await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#account-summary').textContent.includes('Browser voices'));
 assert.equal(await page.locator('#engine').inputValue(),'browser');await page.fill('#text','A free browser reading.');await page.click('#play');await page.waitForFunction(()=>window.__spoken>0);
 assert.equal(mutations.includes('/api/billing/session'),false);assert.equal(mutations.includes('/api/readings'),false);
 await page.locator('#voice-settings > summary').click();await page.selectOption('#engine','google');assert.match(await page.locator('#upgrade-note').textContent(),/verified trial owner/);
 await page.goto(origin+'/api/billing');await page.waitForFunction(()=>document.querySelector('#balance').textContent==='No trial credit');assert.equal(await page.locator('#buy').count(),0);assert.equal(await page.locator('script[src*="paddle"]').count(),0);assert.equal(await page.locator('#send-link').isDisabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'work/production-reader/account-mobile.png',fullPage:true});
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);console.log('PASS: production mobile layout, anonymous browser speech without account, trial wording, no checkout or external requests (mocked APIs/device speech).');
}finally{await browser.close();}
