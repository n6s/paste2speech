// Local public assets only; every API response is synthetic and external requests are blocked.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root='work/production-reader/site',out='work/public-copy-review-20261028';
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=new URL(req.url,'http://local').pathname.slice(1)||'index.html';if(file.includes('..'))throw Error();res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(await readFile(root+'/'+file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});
const errors=[];let providerRequests=0,unavailable=false;
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.origin!==origin)return route.abort();
  if(!path.startsWith('/api/'))return route.continue();
  if(path==='/api/summary/config')return route.fulfill({status:unavailable?503:200,json:unavailable?{}:{available:false,reason:'disabled',detail:'Sign in to summarize. Free browser reading remains available.'}});
  if(path==='/api/reader')return route.fulfill({json:{eligible:true,account:{verified:false,creditRequired:true}}});
  if(path==='/api/translation/config')return route.fulfill({json:{available:false,detail:'Sign in to translate. Free reading is still available.'}});
  if(path==='/api/billing/status')return route.fulfill({json:{unified:true,configured:false,emailConfigured:false,wallet:null,usage:[],month:'2026-10'}});
  if(/^\/api\/(summary\/documents|translation\/documents|readings|ocr\/jobs\/[^/]+\/accept)/.test(path))providerRequests++;
  return route.fulfill({json:{available:false,enabled:false}});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const failed of [false,true]){
  unavailable=failed;await page.goto(origin);await page.fill('#text','A harmless local review fixture.');
  await page.click('#summary-options-toggle');await page.getByText('Fuller explanation and more source detail',{exact:true}).waitFor();
  await page.click('#summary-info');const info=page.locator('#summary-info-details');await info.waitFor({state:'visible'});
  const text=await info.innerText();assert.match(text,/Summaries start at 1 credit/);assert.match(text,/Longer or more detailed summaries can cost more/);assert.doesNotMatch(text,/uses no credits|free summaries|1 credit each|pause|partial|reserv|held|passes/i);
  assert.equal(await page.locator('#summary-mode').isDisabled(),true);
  await page.screenshot({path:`${out}/signed-out-summary-${failed?'unavailable':'normal'}-desktop.png`,fullPage:true});
 }
 unavailable=false;
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  for(const surface of ['pricing','terms','billing.html']){
   await page.goto(origin+'/'+surface);
   const text=await page.locator('body').innerText();assert.match(text,/Summaries start at 1 credit/);assert.match(text,/Google Cloud Translation/);assert.match(text,/4 credits per 1,000 source characters/);assert.doesNotMatch(text,/Creating summaries uses no credits|Each accepted summary uses 1 shared credit|up to 10 pages|6 MB/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`${out}/${surface.replace('.html','')}-${width}.png`,fullPage:true});
  }
 }
 assert.equal(providerRequests,0);assert.deepEqual(errors,[]);
 console.log('PASS: signed-out/missing-price and failed-config Summary copy; Detailed description; Pricing/Terms/account at desktop and 390px; zero provider requests; no page errors.');
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
