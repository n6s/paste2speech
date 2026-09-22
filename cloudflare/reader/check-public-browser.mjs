import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin='https://speak.rogerpbrown.com';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
try{
 const page=await browser.newPage({viewport:{width:393,height:851}}),errors=[],outside=[];let loggedIn=false,full=false,orders=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin==='https://cdn.paddle.com')return route.fulfill({contentType:'text/javascript',body:`window.Paddle={Environment:{set(){throw Error('Live must not select sandbox')}},Initialize(o){window.__paddleToken=o.token},Checkout:{open(o){window.__checkout=o.transactionId}}};`});
  if(u.origin!==origin){outside.push(u.origin);return route.abort();}
  if(u.pathname==='/api/billing/status')return route.fulfill({json:{emailConfigured:true,email:loggedIn?'reader@example.invalid':null,account:loggedIn?{balance:1000000,reserved:0}:null,usage:[],month:'2026-09',sandbox:false,trial:false,configured:loggedIn&&!full,clientToken:loggedIn&&!full?'live_synthetic':'',serviceCapacity:{available:!full,dailyReset:'2026-09-23T00:00:00Z',monthlyReset:'2026-10-01T00:00:00Z'}}});
  if(u.pathname==='/api/billing/session')return route.fulfill({json:{ready:true}});
  if(u.pathname==='/api/billing/order'){orders++;return route.fulfill({json:{order:'order',transactionId:'txn_synthetic'}});}
  if(u.pathname==='/api/billing/reconcile')return route.fulfill({json:{credited:true}});
  if(u.pathname==='/api/reader')return route.fulfill({json:{eligible:false,liveEnabled:true,voices:['en-US-Wavenet-F','en-GB-Wavenet-F']}});
  if(u.pathname==='/api/events')return route.fulfill({status:204});
  const paths={'/':'index.html','/api/billing':'billing.html','/api/billing/app.js':'billing.js'};const name=paths[u.pathname]||u.pathname.slice(1);assert.ok(!name.includes('..'));
  try{return route.fulfill({body:await readFile('work/production-reader/site/'+name),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});}catch{return route.fulfill({status:404});}
 });
 await page.goto(origin+'/api/billing');await page.waitForFunction(()=>document.querySelector('#capacity').textContent.includes('Sign in'));
 assert.ok(await page.locator('#buy').isDisabled());assert.equal(await page.locator('#mode').count(),0);
 loggedIn=true;await page.reload();await page.waitForFunction(()=>!document.querySelector('#buy').disabled);
 await page.click('#buy');await page.waitForFunction(()=>window.__checkout==='txn_synthetic');assert.equal(orders,1);assert.equal(await page.evaluate(()=>window.__paddleToken),'live_synthetic');assert.equal(await page.evaluate(()=>window.__checkout),'txn_synthetic');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'work/production-reader/public-account-mobile.png',fullPage:true});
 full=true;await page.reload();await page.waitForFunction(()=>document.querySelector('#capacity').textContent.includes('temporarily full'));assert.ok(await page.locator('#buy').isDisabled());assert.match(await page.locator('#balance').textContent(),/1,000,000/);
 await page.goto(origin+'/terms');assert.match(await page.locator('body').textContent(),/proportional refund/);
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);console.log('PASS public mobile account: verified checkout, live SDK selection, pending reconciliation, capacity pause, retained balance and policies (mocked external services).');
}finally{await browser.close();}
