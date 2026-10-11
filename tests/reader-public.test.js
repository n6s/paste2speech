import {WAVENET_VOICE_IDS} from '../public/wavenet-voices.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
import {ReaderLedger} from '../cloudflare/reader/ledger.js';
import {EmailIdentity} from '../cloudflare/prepared/identity.js';
import {capacity,dispatchBudget,recordOperations} from '../cloudflare/reader/budget.js';
import {paymentConfig} from '../cloudflare/reader/modes.js';
import {verifyWebhook,receiveWebhook} from '../cloudflare/reader/webhooks.js';
import {PaymentCoordinator} from '../cloudflare/reader/payments-do.js';
import {validPurchase,syncOrder} from '../cloudflare/prepared/payments.js';
const bundled=await build({entryPoints:['cloudflare/reader/worker.js'],bundle:true,write:false,format:'esm',platform:'node'});
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const origin='https://pastetospeech.com',txn='txn_'+'a'.repeat(26);
function setup(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync('cloudflare/reader/migrations').filter(name=>name<'0018').sort())sql.exec(readFileSync('cloudflare/reader/migrations/'+name,'utf8'));
 const db={prepare(text){return {bind(...values){return {first:async()=>sql.prepare(text).get(...values)||null,run:async()=>sql.prepare(text).run(...values),all:async()=>({results:sql.prepare(text).all(...values)})};}};},async batch(statements){sql.exec('BEGIN');try{for(const s of statements)await s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={READER_MODE:'production-public',PUBLIC_LAUNCH_OPEN:'1',LOCAL_READER:'0',PRIVATE_READER:'0',READER_ORIGIN:origin,ENABLE_EMAIL:'0',ENABLE_PAYMENTS:'1',ENABLE_LIVE_SYNTHESIS:'1',LEDGER:db,PADDLE_ENVIRONMENT:'live',PADDLE_API_KEY:'pdl_live_apikey_synthetic',PADDLE_CLIENT_TOKEN:'live_synthetic',PADDLE_PRICE_ID:'pri_'+'b'.repeat(26),PADDLE_PRODUCT_ID:'pro_'+'c'.repeat(26),PADDLE_WEBHOOK_SECRET:'synthetic-only',ASSETS:{fetch:async()=>new Response('reader')},JOBS:{idFromName:id=>id,get:()=>({fetch:async()=>Response.json({ready:true},{status:201})})},PAYMENTS:{idFromName:id=>id,get:()=>({fetch:async()=>Response.json({ready:true})})}};
 for(const k of ['ACCOUNT_LIMIT','EMAIL_LIMIT','CHECKOUT_LIMIT','READING_LIMIT'])env[k]={limit:async()=>({success:true})};
 const ledger=new ReaderLedger(db);
 async function request(path,{data,method=data?'POST':'GET',token,headers={}}={}){return worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,...(token?{Cookie:'p2s_private_reader='+token}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})}),env,{waitUntil:()=>{}});}
 async function verified(email='reader@example.invalid'){const auth=new EmailIdentity(db),link=await auth.request(email,null,crypto.randomUUID()),token=await auth.confirm(link.token,link.flow);return {token,account:await ledger.session(token)};}
 return {sql,db,env,ledger,request,verified};
}
function remote(order){return {id:txn,status:'completed',custom_data:{p2s_order:order.id},currency_code:'USD',items:[{quantity:1,price:{id:order.price_id,product_id:order.product_id,unit_price:{amount:'1000',currency_code:'USD'}}}],details:{totals:{discount:'0',subtotal:'1000'}}};}
async function signed(secret,event,now=Date.now(),raw=JSON.stringify(event)){
 const timestamp=String(Math.floor(now/1000)),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+':'+raw))).toString('hex');
 return new Request(origin+'/api/billing/webhook',{method:'POST',headers:{'Paddle-Signature':`ts=${timestamp};h1=${sig}`},body:raw});
}
test('live configuration rejects sandbox credentials and missing catalog; paused checkout still allows provider config',()=>{
 const s=setup();assert.equal(paymentConfig({...s.env,ENABLE_PAYMENTS:'0'}).environment,'live');
 for(const patch of [{PADDLE_ENVIRONMENT:'sandbox'},{PADDLE_API_KEY:'pdl_sdbx_apikey_fake'},{PADDLE_CLIENT_TOKEN:'test_fake'},{PADDLE_PRICE_ID:''}])assert.throws(()=>paymentConfig({...s.env,...patch}));s.sql.close();
});
test('public anonymous reader stays free; only verified enabled customers can buy or generate',async()=>{
 const s=setup();assert.equal((await s.request('/')).status,200);for(const path of ['/terms','/pricing'])assert.match((await s.request(path)).headers.get('Content-Type'),/text\/html/);assert.equal((await (await s.request('/api/billing/status')).json()).configured,false);
 const anonymous=await (await s.request('/api/reader')).json();assert.deepEqual(anonymous.voices,WAVENET_VOICE_IDS);assert.equal(anonymous.account,null);assert.equal(anonymous.accessAllowed,false);
 const a=await s.verified();
 const unfunded=await (await s.request('/api/reader',{token:a.token})).json();assert.equal(unfunded.account.verified,true);assert.equal(unfunded.accessAllowed,true);assert.equal(unfunded.eligible,false);
 s.sql.prepare('INSERT INTO grants VALUES(?,?,?)').run('grant',a.account.id,100);
 const status=await (await s.request('/api/billing/status',{token:a.token})).json();assert.equal(status.configured,true);assert.equal(status.trial,false);
 const data={voice:'en-US-Wavenet-F',chunks:['Hello.']},headers={'Idempotency-Key':crypto.randomUUID()};
 assert.equal((await s.request('/api/readings',{token:a.token,data,headers})).status,201);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM speech_admissions').get().n,0);
 await s.ledger.enable(a.account.id,false);assert.equal((await s.request('/api/billing/order',{token:a.token,data:{}})).status,403);assert.equal((await s.request('/api/readings',{token:a.token,data,headers})).status,403);s.sql.close();
});
test('public atomic reservation prevents parallel preparations and never re-enables disabled accounts',async()=>{
 const s=setup(),a=await s.verified();s.sql.prepare('INSERT INTO grants VALUES(?,?,?)').run('grant',a.account.id,100);
 const input={chunks:['Hello.'],voice:'en-US-Wavenet-F',mode:'live'};
 for(const id of ['one','two'])s.sql.prepare('INSERT INTO public_jobs VALUES(?,?)').run(id,a.account.id);
 const results=await Promise.allSettled(['one','two'].map(id=>s.ledger.reserve(id,a.account.id,input)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await s.ledger.account(a.account.id)).balance,94);
 const first=results[0].status==='fulfilled'?'one':'two';await s.ledger.reserve(first,a.account.id,input);assert.equal((await s.ledger.account(a.account.id)).balance,94);
 await s.ledger.enable(a.account.id,false);await assert.rejects(s.ledger.reserve('two',a.account.id,input));assert.equal((await s.ledger.account(a.account.id)).enabled,0);s.sql.close();
});
test('daily/monthly budgets are atomic, persistent, unicode-aware and never refund uncertain attempts',async()=>{
 const s=setup();s.sql.exec("UPDATE public_controls SET daily=10,monthly=15");const now=Date.parse('2026-09-22T23:59:59Z');
 const r=await Promise.allSettled([dispatchBudget(s.db,'a',0,'123456',now),dispatchBudget(s.db,'b',0,'123456',now)]);assert.equal(r.filter(v=>v.status==='fulfilled').length,1);
 await assert.rejects(dispatchBudget(s.db,'a',0,'123456',now));assert.equal((await capacity(s.db,now)).dailyRemaining,4);
 await dispatchBudget(s.db,'c',0,'😀😀',now);assert.equal((await capacity(s.db,now)).monthlyRemaining,7);
 const tomorrow=now+2000;await dispatchBudget(s.db,'d',0,'1234567',tomorrow);assert.equal((await capacity(s.db,tomorrow)).available,false);await assert.rejects(dispatchBudget(s.db,'e',0,'x',tomorrow));
 assert.equal((await capacity(s.db,Date.parse('2026-10-01T00:00:00Z'))).monthlyRemaining,15);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM provider_attempts').get().n,3);s.sql.close();
});
test('signed webhook rejects forgery, stale time, body changes; duplicate delivery is stored once without granting credit',async()=>{
 const s=setup(),event={event_id:'evt_'+'d'.repeat(26),event_type:'transaction.completed',data:{id:txn}};
 assert.equal((await verifyWebhook(await signed('secret',event),'secret')).transaction,txn);
 await assert.rejects(verifyWebhook(await signed('secret',event),'wrong'));
 await assert.rejects(verifyWebhook(await signed('secret',event,Date.now()-600000),'secret'));
 const req=await signed('secret',event);await assert.rejects(verifyWebhook(new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify({...event,data:{id:'other'}})}),'secret'));
 const pending=[];for(let i=0;i<2;i++)assert.equal((await receiveWebhook(await signed(s.env.PADDLE_WEBHOOK_SECRET,event),s.env,{waitUntil:p=>pending.push(p)})).status,200);await Promise.all(pending);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM webhook_events').get().n,1);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM grants').get().n,0);s.sql.close();
});
test('public webhook uses signature instead of browser Origin; account mutations still reject cross origin',async()=>{
 const s=setup(),event={event_id:'evt_'+'d'.repeat(26),event_type:'transaction.completed',data:{id:txn}};
 assert.equal((await worker.fetch(await signed(s.env.PADDLE_WEBHOOK_SECRET,event),s.env,{waitUntil:()=>{}})).status,200);
 assert.equal((await s.request('/api/billing/session',{data:{},headers:{Origin:'https://evil.invalid'}})).status,403);s.sql.close();
});
test('snapshotted live catalog grants once; refund debt and reversals reconcile with checkout off',async()=>{
 const s=setup(),a=await s.verified(),offer=paymentConfig(s.env);let order=await s.ledger.newOrder(a.account.id,offer);await s.ledger.bindOrder(order.id,txn);order=await s.ledger.order(order.id,a.account.id);
 const p=remote(order);assert.ok(validPurchase(p,order));assert.equal(validPurchase({...p,items:[{quantity:1,price:{...p.items[0].price,id:'pri_wrong'}}]},order),false);
 let adjustments=[];const provider={config:offer,transaction:async()=>p,adjustments:async()=>adjustments};await syncOrder(s.ledger,order,provider);await syncOrder(s.ledger,order,provider);assert.equal((await s.ledger.account(a.account.id)).balance,1000000);
 s.sql.prepare('INSERT INTO balance_changes(account,delta) VALUES(?,?)').run(a.account.id,-800000);
 adjustments=[{id:'adj_'+'e'.repeat(26),transaction_id:txn,currency_code:'USD',status:'approved',action:'refund',totals:{subtotal:'500'}}];await syncOrder(s.ledger,order,provider);assert.equal((await s.ledger.account(a.account.id)).shortfall,300000);
 adjustments[0].status='reversed';await syncOrder(s.ledger,order,provider);assert.equal((await s.ledger.account(a.account.id)).balance,200000);
 adjustments[0].status='approved';adjustments[0].action='chargeback';adjustments[0].totals.subtotal='1000';await syncOrder(s.ledger,order,provider);assert.equal((await s.ledger.account(a.account.id)).shortfall,800000);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM grants').get().n,1);s.sql.close();
});
test('webhook recovers lost transaction creation and reconciles while purchases are paused',async t=>{
 const s=setup(),a=await s.verified();let order=await s.ledger.newOrder(a.account.id,paymentConfig(s.env));s.sql.prepare("UPDATE orders SET creation_state='submitting' WHERE id=?").run(order.id);
 const p=remote(order);s.sql.prepare('INSERT INTO webhook_events(id,transaction_id,received) VALUES(?,?,?)').run('event',txn,Date.now());s.env.ENABLE_PAYMENTS='0';
 t.mock.method(globalThis,'fetch',async url=>{assert.ok(url.startsWith('https://api.paddle.com/'));return Response.json(url.includes('/adjustments?')?{data:[],meta:{pagination:{has_more:false}}}:{data:p});});
 const ctx={storage:{getAlarm:async()=>null,setAlarm:async()=>{}}};await new PaymentCoordinator(ctx,s.env).alarm();
 assert.equal((await s.ledger.account(a.account.id)).balance,1000000);assert.ok(s.sql.prepare('SELECT processed FROM webhook_events').get().processed);
 await new PaymentCoordinator(ctx,s.env).alarm();assert.equal((await s.ledger.account(a.account.id)).balance,1000000);s.sql.close();
});
test('exhaustion disables checkout without hiding account or credit',async()=>{
 const s=setup(),a=await s.verified();s.sql.exec('UPDATE public_controls SET daily=1,monthly=1');await dispatchBudget(s.db,'used',0,'x');
 const status=await (await s.request('/api/billing/status',{token:a.token})).json();assert.equal(status.configured,false);assert.equal(status.account.id,a.account.id);assert.equal(status.serviceCapacity.available,false);s.sql.close();
});
test('closed launch permits only designated verified tester; reconciliation remains accessible',async()=>{
 const s=setup(),a=await s.verified();s.env.PUBLIC_LAUNCH_OPEN='0';s.env.LAUNCH_TEST_EMAIL='owner@example.invalid';
 assert.equal((await (await s.request('/api/billing/status',{token:a.token})).json()).configured,false);
 assert.equal((await s.request('/api/billing/order',{token:a.token,data:{}})).status,403);
 assert.equal((await s.request('/api/billing/reconcile',{token:a.token,data:{order:'known'}})).status,200);
 s.env.LAUNCH_TEST_EMAIL='reader@example.invalid';assert.equal((await (await s.request('/api/billing/status',{token:a.token})).json()).configured,true);s.sql.close();
});

test('operational alerts report transitions without customer content',async t=>{
 const s=setup(),messages=[];t.mock.method(console,'error',v=>messages.push(v));t.mock.method(console,'log',v=>messages.push(v));
 s.sql.exec('UPDATE public_controls SET daily=10,monthly=15');
 await recordOperations(s.env);await recordOperations(s.env);
 assert.equal(messages.length,2);assert.ok(messages.every(v=>!v.includes('@')));
 s.sql.exec('UPDATE public_controls SET daily=2500000,monthly=12500000');await recordOperations(s.env);
 assert.equal(messages.length,4);assert.equal(s.sql.prepare('SELECT SUM(active) n FROM operations_alerts').get().n,0);s.sql.close();
});

test('a delayed budget write crossing midnight cannot authorize speech in the old period',async()=>{
 const s=setup();let calls=0;const clock=()=>Date.parse(calls++===0?'2026-09-30T23:59:59.999Z':'2026-10-01T00:00:00Z');
 await assert.rejects(dispatchBudget(s.db,'boundary',0,'hello',clock),/period changed/);
 assert.equal(s.sql.prepare("SELECT characters FROM provider_periods WHERE period='2026-09-30'").get().characters,5);s.sql.close();
});
test('failed webhook processing backs off without starving another completed purchase',async t=>{
 const s=setup(),a=await s.verified();let order=await s.ledger.newOrder(a.account.id,paymentConfig(s.env));await s.ledger.bindOrder(order.id,txn);order=await s.ledger.order(order.id,a.account.id);
 const bad='txn_'+'z'.repeat(26);let failures=0;
 for(const [id,transaction] of [['bad',bad],['good',txn]])s.sql.prepare('INSERT INTO webhook_events(id,transaction_id,received) VALUES(?,?,?)').run(id,transaction,Date.now());
 t.mock.method(globalThis,'fetch',async url=>{if(url.endsWith(bad)){failures++;return new Response('',{status:503});}return Response.json(url.includes('/adjustments?')?{data:[],meta:{pagination:{has_more:false}}}:{data:remote(order)});});
 const coordinator=new PaymentCoordinator({storage:{getAlarm:async()=>null,setAlarm:async()=>{}}},s.env);await coordinator.alarm();await coordinator.alarm();
 assert.equal(failures,1);assert.equal((await s.ledger.account(a.account.id)).balance,1000000);assert.ok(s.sql.prepare("SELECT next_attempt FROM webhook_events WHERE id='bad'").get().next_attempt>Date.now());s.sql.close();
});
test('closed public launch admits progressive playback only for tester and excludes fixture controls',async()=>{
 const s=setup(),a=await s.verified();s.env.PUBLIC_LAUNCH_OPEN='0';s.env.LAUNCH_TEST_EMAIL='owner@example.invalid';s.env.PROGRESSIVE_READER='1';
 s.sql.prepare('INSERT INTO grants VALUES(?,?,?)').run('progressive-grant',a.account.id,100);
 const data={voice:'en-US-Wavenet-F',chunks:['Hello.'],delivery:'mse'},headers={'Idempotency-Key':crypto.randomUUID()};
 assert.equal((await s.request('/api/readings',{token:a.token,data,headers})).status,403);
 s.env.LAUNCH_TEST_EMAIL='reader@example.invalid';
 assert.equal((await s.request('/api/readings',{token:a.token,data,headers})).status,201);
 assert.equal((await s.request('/api/readings',{token:a.token,data:{...data,cached:true},headers})).status,422);
 assert.equal((await s.request('/api/staging/fixtures',{token:a.token})).status,404);s.sql.close();
});


test('canonical public HTTP navigation redirects without asset/state access and preserves escaped path/query',async()=>{
 const s=setup(),env={...s.env,ASSETS:{fetch(){throw Error('Redirect must not serve an asset');}},LEDGER:{prepare(){throw Error('Redirect must not read state');}}};
 for(const method of ['GET','HEAD'])for(const path of ['/','/pricing','/terms','/robots.txt','/sitemap.xml','/favicon.ico','/a%2Fb?from=http&x=a%2Bb&x=2']){
  const response=await worker.fetch(new Request('http://pastetospeech.com'+path,{method}),env,{});assert.equal(response.status,308);assert.equal(response.headers.get('Location'),'https://pastetospeech.com'+path);assert.equal(await response.text(),'');assert.equal(response.headers.get('Cache-Control'),'no-store');
 }
});
test('HTTP redirect does not relax API, mutation, noncanonical host, local, trial or staging restrictions',async()=>{
 const s=setup();
 for(const path of ['/api','/api/owner','/api/readings','/api/billing/webhook'])assert.equal((await worker.fetch(new Request('http://pastetospeech.com'+path),s.env,{})).status,403);
 for(const method of ['POST','DELETE','PUT','OPTIONS'])assert.equal((await worker.fetch(new Request('http://pastetospeech.com/',{method}),s.env,{})).status,403);
 for(const host of ['other.example.invalid','pastetospeech.com.evil.invalid','pastetospeech.com:8080','staging.pastetospeech.com'])assert.equal((await worker.fetch(new Request('http://'+host+'/'),s.env,{})).status,403);
 for(const patch of [{READER_MODE:'production-trial'},{LOCAL_READER:'1'},{READER_MODE:'staging',PRIVATE_READER:'1',READER_ORIGIN:'https://staging.pastetospeech.com'}])assert.equal((await worker.fetch(new Request('http://pastetospeech.com/'),{...s.env,...patch},{})).status,403);
 assert.equal((await s.request('/')).status,200);assert.equal((await s.request('/api/owner')).status,403);assert.equal((await s.request('/api/readings',{data:{chunks:['Do not synthesize.']}})).status,401);assert.equal((await s.request('/api/billing/order',{data:{}})).status,401);
});
