import {build} from 'esbuild';
const bundled=await build({entryPoints:['cloudflare/reader/owner-dashboard.js'],bundle:true,write:false,format:'esm',platform:'node',keepNames:true});
const {ownerResponse}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
await mkdir('work/owner-dashboard',{recursive:true});
const group={accounts:0,activeAccounts:0,readings:0,characters:0,failures:0,preparing:0,purchases:0,reversedPurchases:0};
const report={environment:'Preview · sample data',generatedAt:new Date().toISOString(),groups:{customers:{...group,accounts:8,activeAccounts:3,readings:9,characters:125000,purchases:2},owner:{...group,accounts:1,readings:2,characters:90,purchases:1,reversedPurchases:1}},events:[{day:'2026-09-29',event:'page_view',engine:'none',count:23},{day:'2026-09-29',event:'playback_start',engine:'browser',count:7},{day:'2026-09-29',event:'playback_start',engine:'google',count:4}],health:{stuckReadings:0,delayedWebhooks:0,paymentErrors:0}};
const env={OWNER_EMAIL:'preview@example.invalid',LEDGER:{prepare(){return {bind(){return {first:async()=>({account:'preview'})};}};}}};
const server=createServer(async(req,res)=>{try{const response=req.url.startsWith('/api/owner/report')?Response.json(report):await ownerResponse(new Request('http://localhost'+req.url),env,'preview');res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());}catch{res.writeHead(500);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome'});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/api/owner`);await page.locator('#results').waitFor({state:'visible'});
 if(await page.locator('#views').textContent()!=='23')throw Error('Missing totals');
 await page.screenshot({path:'work/owner-dashboard/desktop.png',fullPage:true});
 await page.selectOption('#period','today');await page.locator('#results').waitFor({state:'visible'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'work/owner-dashboard/mobile.png',fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');
 await page.route('**/api/owner/report?*',r=>r.fulfill({status:403,body:'Denied'}));await page.click('#refresh');await page.getByText('Your owner session has expired.',{exact:false}).waitFor();
 if(await page.locator('#results').isVisible())throw Error('Stale report visible after error');
 if(errors.length)throw Error(errors.join('\n'));console.log('Desktop, mobile, period selection, session-expiry and browser errors checked.');
}finally{await browser.close();server.close();}
