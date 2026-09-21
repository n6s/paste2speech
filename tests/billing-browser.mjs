// Local UI test: fake Paddle SDK and APIs; no external requests or payments.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
let enabled=false,credited=false,orders=0,checks=0;
const server=createServer(async(req,res)=>{
 const path=req.url;res.setHeader('Content-Type','application/json');
 if(path==='/api/billing'){res.setHeader('Content-Type','text/html');res.end(await readFile('server/billing/index.html'));return;}
 if(path==='/api/billing/app.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile('server/billing/app.js'));return;}
 if(path==='/api/billing/session'){res.end('{}');return;}
 if(path==='/api/billing/status'){res.end(JSON.stringify({configured:true,clientToken:'test_fake',month:'2026-09',account:{balance:credited?3000000:0,reserved:0,enabled},usage:[{provider:'workstation',kind:'personal',seconds:120,providerCost:0}]}));return;}
 if(path==='/api/billing/order'){orders++;res.end(JSON.stringify({order:'test-order',transactionId:'txn_fake'}));return;}
 if(path==='/api/billing/reconcile'){credited=++checks>=3;res.end(JSON.stringify({credited,status:credited?'completed':'paid'}));return;}
 if(path==='/api/billing/mode'){let raw='';for await(const part of req)raw+=part;enabled=JSON.parse(raw).enabled;res.end(JSON.stringify({enabled}));return;}
 res.statusCode=404;res.end('{}');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:412,height:915}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cdn.paddle.com/**',route=>route.fulfill({contentType:'text/javascript',body:`window.Paddle={Environment:{set(v){if(v!=='sandbox')throw Error('Live environment!')}},Initialize(v){window.config=v},Checkout:{open(v){window.checkout=v;window.config.eventCallback({name:'checkout.completed'})}}};`}));
 await page.goto(`http://127.0.0.1:${server.address().port}/api/billing`);
 await page.getByRole('button',{name:'Test buying a pack'}).click();
 // Paddle emits checkout.completed before its transaction API becomes completed.
 // Credit must appear automatically after pending API responses, with no refresh.
 await page.waitForFunction(()=>document.querySelector('#balance').textContent.startsWith('3,000,000'));
 await page.getByRole('checkbox').check();
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('use the test allowance'));
 assert.equal(checks,3);assert.equal(enabled,true);assert.equal(orders,1);assert.equal(await page.evaluate(()=>window.checkout.transactionId),'txn_fake');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);await mkdir('work/billing-validation',{recursive:true});await page.screenshot({path:'work/billing-validation/mobile.png',fullPage:true});
 console.log('Billing page: sandbox checkout, credit refresh, mode switch, mobile layout passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
