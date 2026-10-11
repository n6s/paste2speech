import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {fixture,purchase,input,legacy,now,txn} from './helpers/unified-wallet-fixture.js';
import {ReaderLedger} from '../cloudflare/reader/ledger.js';
import {UsageLedger,digest} from '../cloudflare/prepared/ledger.js';
import {UnifiedWallet,unifiedEnabled} from '../cloudflare/reader/unified-wallet.js';
import {unifiedPaymentConfig,unifiedCheckoutStatus,syncUnifiedOrder} from '../cloudflare/reader/unified-payments.js';
import {UnifiedPaymentCoordinator} from '../cloudflare/reader/payments-do.js';
import {retailDocumentOcr} from '../cloudflare/reader/document-ocr-retail.js';
import {mistralOcrPayload} from '../cloudflare/reader/document-ocr.js';
import {receiveWebhook} from '../cloudflare/reader/webhooks.js';
import {capacity,dispatchBudget} from '../cloudflare/reader/budget.js';
import {assertPublicSharedCatalog} from '../scripts/reader-release-policy.mjs';
const bundle=await build({entryPoints:['cloudflare/reader/worker.js'],bundle:true,write:false,format:'esm',platform:'node'});
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const migrate=sql=>sql.exec(readFileSync('cloudflare/reader/migrations/0017_unified_wallet.sql','utf8'));
async function session(f){await f.sql.prepare("INSERT INTO sessions(token_hash,account,expires,kind) VALUES(?,'a',?,'verified')").run(await digest('fixture-token'),Date.now()+3600000);}
function post(path,data,headers={}){return new Request('https://pastetospeech.com'+path,{method:'POST',headers:{Origin:'https://pastetospeech.com',Cookie:'p2s_private_reader=fixture-token','Content-Type':'application/json',...headers},body:JSON.stringify(data)});}
async function fund(f){const p=await purchase(f);await syncUnifiedOrder(f.wallet,p.order,p.provider);return p;}
function form(){const data=new FormData();data.append('file',new File([readFileSync('tests/fixtures/ocr/billing-proof.pdf')],'proof.pdf',{type:'application/pdf'}));data.append('pages','1');data.append('model','mistral-ocr-4-1');data.append('consent','true');return data;}
function storage(){let alarm=null;const map=new Map();return {get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),delete:async k=>map.delete(k),getAlarm:async()=>alarm,setAlarm:async v=>{alarm=v;},deleteAlarm:async()=>{alarm=null;}};}

test('production migration preserves every legacy record and in-flight settlement while opening zero wallets',async()=>{
 const f=fixture('legacy'),old=new ReaderLedger(f.db),payments=new UsageLedger(f.db);
 await old.reserve('old-speech','a',input);
 f.sql.prepare("INSERT INTO ocr_attempts(id,account,document_hash,model,mime,pages,name,created,updated,deadline) VALUES('old-scan','a','old','fixture','image/png',1,'old',?,?,?)").run(now,now,now+300000);
 let order=await payments.newOrder('a',{environment:'live',price:f.env.PADDLE_PRICE_ID,product:f.env.PADDLE_PRODUCT_ID,amount:'1000',currency:'USD',characters:1000000});await payments.bindOrder(order.id,txn);await payments.syncPayment(order.id,txn,'completed',1000000);
 const tables=['accounts','identities','orders','grants','payment_sync','account_debt','ocr_accounts','ocr_business_budget','ocr_business_reservations'];
 const snapshots=Object.fromEntries(tables.map(t=>[t,f.sql.prepare('SELECT * FROM '+t).all()]));
 migrate(f.sql);for(const t of tables)assert.deepEqual(f.sql.prepare('SELECT * FROM '+t).all(),snapshots[t],t);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM unified_wallets').get().n,0);assert.equal((await f.wallet.balance('a')).balance,0);
 assert.equal(f.sql.prepare("SELECT wallet_version FROM reservations WHERE job='old-speech'").get().wallet_version,'legacy');assert.equal(f.sql.prepare("SELECT wallet_version FROM ocr_attempts WHERE id='old-scan'").get().wallet_version,'legacy');
 await f.speech.settle({id:'old-speech',owner:'a',state:'cancelled',parts:[{state:'failed'},{state:'failed'}],voice:input.voice,mode:'live',created:now});
 f.sql.prepare("INSERT INTO ocr_settlements(attempt,outcome,created) VALUES('old-scan','uncertain',?)").run(now);
 assert.deepEqual(legacy(f),[12345,17]);assert.equal((await f.wallet.balance('a')).balance,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM unified_events').get().n,0);
 assert.throws(()=>f.grant(100000),'Production does not accept test grants');assert.throws(()=>f.sql.exec("UPDATE unified_controls SET id='staging'"));
});

test('production wallet rejects unapproved modes, sandbox credentials, fixture providers and staging databases',async()=>{
 const f=fixture('production');assert.equal(unifiedPaymentConfig(f.env).environment,'live');
 for(const patch of [{UNIFIED_LIVE_APPROVED:'0'},{PADDLE_ENVIRONMENT:'sandbox'},{READER_MODE:'production-trial'},{LOCAL_READER:'1'},{OCR_RETAIL_PROVIDER_MODE:'synthetic'},{PADDLE_API_KEY:'pdl_sdbx_apikey_fake'},{PADDLE_CLIENT_TOKEN:'test_fake'},{PADDLE_UNIFIED_PRICE_ID:f.env.PADDLE_OCR_PRICE_ID}])assert.throws(()=>unifiedPaymentConfig({...f.env,...patch}));
 const stage=fixture();await assert.rejects(new UnifiedWallet(stage.db,f.env).balance('a'),/database environment mismatch/);
 await assert.rejects(new ReaderLedger(stage.db,f.env).reserve('cross','a',input),/database environment mismatch/);
 await assert.rejects(new UnifiedWallet(f.db,stage.env).newOrder('a',unifiedPaymentConfig(stage.env)),/database environment mismatch/);
 assert.equal(unifiedEnabled({...f.env,UNIFIED_CREDITS:'0'}),false);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM unified_events').get().n,0);
});

test('production paid snapshots reject wrong environment, currency, subscription, quantity and price before any grant',async()=>{
 const f=fixture('production'),p=await purchase(f);
 await assert.rejects(syncUnifiedOrder(f.wallet,{...p.order,environment:'sandbox'},p.provider));
 for(const patch of [{currency_code:'EUR'},{subscription_id:'sub_fake'},{details:{totals:{subtotal:'999',discount:'0'}}},{items:[{...p.remote.items[0],quantity:2}]},{items:[{...p.remote.items[0],price:{...p.remote.items[0].price,id:f.env.PADDLE_PRICE_ID}}]}]){
  const provider={...p.provider,transaction:async()=>({...p.remote,...patch})};await assert.rejects(syncUnifiedOrder(f.wallet,p.order,provider));
 }
 assert.equal((await f.wallet.balance('a')).balance,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM unified_grants').get().n,0);
});

test('production purchase/refund idempotency and debt survive parallel speech/OCR holds and partial failure',async()=>{
 const f=fixture('production'),p=await fund(f);await syncUnifiedOrder(f.wallet,p.order,p.provider);await f.speech.reserve('held','a',input);f.ocr('held-ocr',2);
 assert.equal((await f.wallet.balance('a')).held,4005);p.setRefund(1000);await syncUnifiedOrder(f.wallet,p.order,p.provider);await syncUnifiedOrder(f.wallet,p.order,p.provider);assert.equal((await f.wallet.balance('a')).debt,4005);await assert.rejects(f.speech.assertOpen('held','a'));
 await f.speech.settle({id:'held',owner:'a',state:'failed',parts:[{state:'ready',samples:24},{state:'failed'}],voice:input.voice,mode:'live',created:now});
 f.sql.prepare("INSERT INTO ocr_settlements(attempt,outcome,created) VALUES('held-ocr','uncertain',?)").run(now);
 const balance=await f.wallet.balance('a');assert.equal(balance.debt,3);assert.equal(balance.held,0);assert.equal(balance.balance,0);
 const q=await purchase(f,'txn_'+'v'.repeat(26));await syncUnifiedOrder(f.wallet,q.order,q.provider);assert.equal((await f.wallet.balance('a')).balance,999997);assert.deepEqual(legacy(f),[12345,17]);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM unified_grants').get().n,2);assert.throws(()=>f.sql.exec('DELETE FROM unified_payment_commands'));assert.throws(()=>f.sql.exec('DELETE FROM unified_events'));
});

test('production concurrency, lost acknowledgements and failed payment commands cannot overspend or half-grant',async()=>{
 const f=fixture('production'),p=await purchase(f);f.loseAck('INSERT INTO unified_payment_commands');await assert.rejects(syncUnifiedOrder(f.wallet,p.order,p.provider));await syncUnifiedOrder(f.wallet,p.order,p.provider);assert.equal((await f.wallet.balance('a')).balance,1000000);
 const rows=await Promise.allSettled([f.speech.reserve('all','a',{...input,chunks:['x'.repeat(1000000)]}),Promise.resolve().then(()=>f.ocr('scan',1))]);assert.equal(rows.filter(r=>r.status==='fulfilled').length,1);assert.equal(rows.filter(r=>r.status==='rejected').length,1);assert.ok((await f.wallet.balance('a')).balance>=0);
 const g=fixture('production'),q=await purchase(g);g.sql.exec("CREATE TRIGGER failure BEFORE INSERT ON unified_payment_sync BEGIN SELECT RAISE(ABORT,'fixture'); END");await assert.rejects(syncUnifiedOrder(g.wallet,q.order,q.provider));assert.equal(g.sql.prepare('SELECT COUNT(*) n FROM unified_grants').get().n,0);assert.equal(g.sql.prepare('SELECT COUNT(*) n FROM unified_payment_commands').get().n,0);
});

test('production OCR needs no staging permit; consent, complete output and paused replay use the right wallet',async()=>{
 const f=fixture('production');await session(f);await fund(f);let calls=0;const options={token:'fixture-token',now:()=>now,payload:mistralOcrPayload,fetcher:async()=>{calls++;return Response.json({model:'mistral-ocr-4-1',usage_info:{pages_processed:1},pages:[{index:0,markdown:'Isolated provider result.'}]});}};
 const get=()=>new Request('https://pastetospeech.com/api/ocr/config');assert.equal((await (await retailDocumentOcr(get(),f.env,options)).json()).canSubmit,true);
 const without=form();without.set('consent','false');assert.equal((await retailDocumentOcr(new Request('https://pastetospeech.com/api/ocr',{method:'POST',body:without}),f.env,options)).status,422);assert.equal(calls,0);
 f.env.PAID_ADMISSIONS_PAUSED='1';assert.equal((await (await retailDocumentOcr(get(),f.env,options)).json()).canSubmit,false);assert.equal((await retailDocumentOcr(new Request('https://pastetospeech.com/api/ocr',{method:'POST',body:form()}),f.env,options)).status,503);assert.equal(calls,0);
 f.env.PAID_ADMISSIONS_PAUSED='0';const result=await (await retailDocumentOcr(new Request('https://pastetospeech.com/api/ocr',{method:'POST',body:form()}),f.env,options)).json();assert.equal(result.p2s_ocr.creditsUsed,2);assert.equal(result.p2s_ocr.balance,998000);assert.equal(calls,1);
 f.env.PAID_ADMISSIONS_PAUSED='1';const replay=await (await retailDocumentOcr(new Request('https://pastetospeech.com/api/ocr/result'),f.env,options)).json();assert.equal(replay.p2s_ocr.creditsUsed,0);assert.equal(calls,1);assert.deepEqual(legacy(f),[12345,17]);
});

test('stale speech/OCR clients cannot silently buy shared credits; old reconciliation and existing readings continue during pause',async()=>{
 const f=fixture('production');await session(f);const routes=[];f.env.PAYMENTS=f.env.OCR_PAYMENTS={idFromName:n=>n,get:n=>({fetch:async(url,options)=>{routes.push({name:n,url,body:JSON.parse(options.body)});return Response.json({ready:true});}})};f.env.JOBS={idFromName:n=>n,get:n=>({fetch:async()=>Response.json({ready:true},{status:201})})};for(const name of ['CHECKOUT_LIMIT','READING_LIMIT'])f.env[name]={limit:async()=>({success:true})};
 const send=(path,data,headers)=>worker.fetch(post(path,data,headers),f.env,{waitUntil:()=>{}});
 for(const data of [{},{offer:'speech'},{offer:'ocr'}])assert.equal((await send('/api/billing/order',data)).status,422);assert.equal(routes.length,0);
 assert.equal((await send('/api/billing/order',{offer:'credits'})).status,200);assert.equal(routes.pop().name,'unified-v1');
 f.env.ENABLE_PAYMENTS='0';f.env.PAID_ADMISSIONS_PAUSED='1';for(const offer of [undefined,'speech','ocr','credits']){assert.equal((await send('/api/billing/reconcile',{offer,order:'old-order'})).status,200);assert.equal(routes.pop().name,offer==='credits'?'unified-v1':'coordinator');}
 await fund(f);const id=crypto.randomUUID();f.sql.prepare('INSERT INTO public_jobs VALUES(?,?)').run(id,'a');await f.speech.reserve(id,'a',input);
 assert.equal((await send('/api/readings',input,{'Idempotency-Key':crypto.randomUUID()})).status,503);assert.equal((await send('/api/readings',input,{'Idempotency-Key':id})).status,201);
});

test('public verified customers, owner-first opening and shared capacity remain separate from payment pause',async()=>{
 const f=fixture('production'),account={email:'b@example.invalid',enabled:1};assert.equal(unifiedCheckoutStatus(f.env,account,{available:true},null).configured,true);
 const closed={...f.env,PUBLIC_LAUNCH_OPEN:'0',LAUNCH_TEST_EMAIL:f.env.OWNER_EMAIL};assert.equal(unifiedCheckoutStatus(closed,account,{available:true},null).checkoutUnavailableReason,'account');assert.equal(unifiedCheckoutStatus(closed,{email:f.env.OWNER_EMAIL,enabled:1},{available:true},null).configured,true);
 f.sql.exec('UPDATE ocr_business_budget SET cap_cents=500');const config=unifiedPaymentConfig(f.env),orders=await Promise.allSettled([f.wallet.newOrder('a',config),f.wallet.newOrder('b',config)]);assert.equal(orders.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.sql.prepare('SELECT committed_cents FROM unified_capacity').get().committed_cents,500);assert.equal(f.sql.prepare('SELECT daily,monthly FROM public_controls').get().daily,2500000);assert.equal(f.sql.prepare('SELECT monthly FROM public_controls').get().monthly,12500000);
});

test('signed production webhooks still queue shared and legacy adjustments when new buying and work are paused',async()=>{
 const f=fixture('production');f.env.ENABLE_PAYMENTS='0';f.env.PAID_ADMISSIONS_PAUSED='1';f.env.PADDLE_WEBHOOK_SECRET='isolated-secret';const wakes=[];f.env.PAYMENTS=f.env.OCR_PAYMENTS={idFromName:n=>n,get:n=>({fetch:async()=>{wakes.push(n);return Response.json({});}})};
 const ts=String(Math.floor(Date.now()/1000)),raw=JSON.stringify({event_id:'evt_'+'e'.repeat(26),event_type:'adjustment.updated',data:{transaction_id:txn}});const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(f.env.PADDLE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+':'+raw))).toString('hex');const request=()=>new Request('https://pastetospeech.com/api/billing/webhook',{method:'POST',headers:{'Paddle-Signature':`ts=${ts};h1=${signature}`},body:raw});const pending=[];
 for(let i=0;i<2;i++)assert.equal((await receiveWebhook(request(),f.env,{waitUntil:p=>pending.push(p)})).status,200);await Promise.all(pending);
 for(const table of ['unified_webhook_events','webhook_events','ocr_webhook_events'])assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,1);assert.ok(wakes.includes('unified-v1'));assert.ok(wakes.includes('coordinator'));assert.equal((await f.wallet.balance('a')).balance,0);
});

test('production coordinator recovers a lost creation response and refunds on alarms while purchases stay paused',async()=>{
 const f=fixture('production'),coordinator=new UnifiedPaymentCoordinator({storage:storage()},f.env);let creates=0,remote;
 coordinator.provider=()=>({config:unifiedPaymentConfig(f.env),create:async order=>{creates++;remote={id:txn,status:'completed',custom_data:{p2s_order:order.id},currency_code:'USD',items:[{quantity:1,price:{id:order.price_id,product_id:order.product_id,billing_cycle:null,unit_price:{amount:'1000',currency_code:'USD'}}}],details:{totals:{subtotal:'1000',discount:'0'}}};throw Error('lost acknowledgement');},transaction:async()=>remote,adjustments:async()=>[]});
 const create=()=>new Request('https://payments/',{method:'POST',body:JSON.stringify({action:'order',account:'a'})});assert.equal((await coordinator.fetch(create())).status,503);assert.equal((await coordinator.fetch(create())).status,409);
 f.env.ENABLE_PAYMENTS='0';f.env.PAID_ADMISSIONS_PAUSED='1';f.sql.prepare('INSERT INTO unified_webhook_events(id,transaction_id,received) VALUES(?,?,?)').run('evt_'+'z'.repeat(26),txn,now);await coordinator.alarm();assert.equal(creates,1);assert.equal((await f.wallet.balance('a')).balance,1000000);
 const provider=coordinator.provider();coordinator.provider=()=>({...provider,adjustments:async()=>[{id:'adj_'+'r'.repeat(26),transaction_id:txn,currency_code:'USD',status:'approved',action:'refund',totals:{subtotal:'1000'}}]});f.sql.exec('UPDATE unified_payment_sync SET next_check=0');await coordinator.alarm();assert.equal((await f.wallet.balance('a')).balance,0);assert.equal((await coordinator.fetch(create())).status,503);
});

test('late legacy completion and approved refund remain in original ledgers after cutover',async()=>{
 const f=fixture('legacy'),old=new UsageLedger(f.db);let order=await old.newOrder('a',{environment:'live',price:f.env.PADDLE_PRICE_ID,product:f.env.PADDLE_PRODUCT_ID,amount:'1000',currency:'USD',characters:1000000});await old.bindOrder(order.id,txn);migrate(f.sql);
 await old.syncPayment(order.id,txn,'completed',0);assert.equal((await f.wallet.balance('a')).balance,0);assert.equal(legacy(f)[0],1012345);await old.syncPayment(order.id,txn,'completed',1000000);await old.syncPayment(order.id,txn,'completed',1000000);assert.deepEqual(legacy(f),[12345,17]);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM unified_events').get().n,0);
});

test('production pending/rejected refunds never revoke credit and approved reversal restores once',async()=>{
 const f=fixture('production'),p=await fund(f),adjustment={id:'adj_'+'r'.repeat(26),transaction_id:txn,currency_code:'USD',action:'refund',totals:{subtotal:'1'}};let status='pending_approval';const provider={...p.provider,adjustments:async()=>[{...adjustment,status}]};
 for(const state of ['pending_approval','rejected','reversed']){status=state;await syncUnifiedOrder(f.wallet,p.order,provider);assert.equal((await f.wallet.balance('a')).balance,1000000);}
 status='approved';await syncUnifiedOrder(f.wallet,p.order,provider);await syncUnifiedOrder(f.wallet,p.order,provider);assert.equal((await f.wallet.balance('a')).balance,999000);status='reversed';await syncUnifiedOrder(f.wallet,p.order,provider);await syncUnifiedOrder(f.wallet,p.order,provider);assert.equal((await f.wallet.balance('a')).balance,1000000);
 // Paddle marks the original adjustment reversed when it creates the reversal.
 for(const action of ['chargeback','credit']){
  const original={...adjustment,action,status:'approved',totals:{subtotal:'1000'}};
  await syncUnifiedOrder(f.wallet,p.order,{...p.provider,adjustments:async()=>[original]});assert.equal((await f.wallet.balance('a')).balance,0);
  const reversal={...original,id:'adj_'+'v'.repeat(26),action:action+'_reverse'};
  const restored={...p.provider,adjustments:async()=>[{...original,status:'reversed'},reversal]};await syncUnifiedOrder(f.wallet,p.order,restored);await syncUnifiedOrder(f.wallet,p.order,restored);assert.equal((await f.wallet.balance('a')).balance,1000000);
 }
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM unified_grants').get().n,1);
});


test('production deployment preflight rejects missing or reused shared catalog IDs',()=>{
 const vars=JSON.parse(readFileSync('cloudflare/reader/wrangler.public.jsonc')).vars;assert.throws(()=>assertPublicSharedCatalog({...vars,PADDLE_UNIFIED_PRICE_ID:'',PADDLE_UNIFIED_PRODUCT_ID:''}),/Verified separate live shared-credit catalog/);
 const f=fixture('production');assert.doesNotThrow(()=>assertPublicSharedCatalog(f.env));assert.throws(()=>assertPublicSharedCatalog({...f.env,PADDLE_UNIFIED_PRICE_ID:f.env.PADDLE_PRICE_ID}));assert.throws(()=>assertPublicSharedCatalog({...f.env,PADDLE_UNIFIED_PRODUCT_ID:f.env.PADDLE_OCR_PRODUCT_ID}));
});


test('authorized owner testing grant is exact, one-time, immutable and counts toward the retained provider ceiling',async()=>{
 const f=fixture('production'),grant=readFileSync('cloudflare/reader/operations/owner-testing-grant.sql','utf8');f.sql.exec("UPDATE identities SET email='rogerpbrown@gmail.com' WHERE account='a'");
 f.sql.exec(grant);assert.equal((await f.wallet.balance('a')).balance,100000);assert.equal(f.sql.prepare('SELECT committed_cents FROM unified_capacity').get().committed_cents,50);f.sql.exec(grant);assert.equal((await f.wallet.balance('a')).balance,100000);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM unified_events WHERE kind='owner-test-grant'").get().n,1);
 await f.speech.reserve('test','a',input);f.sql.exec(grant);assert.equal((await f.wallet.balance('a')).balance,99995);assert.equal((await f.wallet.balance('a')).held,5);
 const p=await purchase(f);await syncUnifiedOrder(f.wallet,p.order,p.provider);await assert.rejects(f.wallet.newOrder('b',unifiedPaymentConfig(f.env)),/capacity/);assert.equal(f.sql.prepare('SELECT cap_cents FROM unified_capacity').get().cap_cents,1000);
 assert.throws(()=>f.sql.exec("DELETE FROM unified_events WHERE kind='owner-test-grant'"));assert.throws(()=>f.sql.exec("INSERT INTO unified_events VALUES('other','b','owner-test-grant','roger-approved-production-testing-2026-10-11',100000,1,NULL)"));
 const full=fixture('production');full.sql.exec("UPDATE identities SET email='rogerpbrown@gmail.com' WHERE account='a'");full.sql.exec('UPDATE ocr_business_budget SET cap_cents=49');assert.throws(()=>full.sql.exec(grant),/capacity/);assert.equal((await full.wallet.balance('a')).balance,0);
});


const uncap=f=>f.sql.exec(readFileSync('cloudflare/reader/migrations/0018_public_provider_spending.sql','utf8'));
test('approved public spending migration preserves financial records and removes OCR sales ceilings',async()=>{
 const f=fixture('production');await fund(f);const prior=f.sql.prepare('SELECT * FROM unified_events').all();uncap(f);assert.deepEqual(f.sql.prepare('SELECT * FROM unified_events').all(),prior);assert.deepEqual(legacy(f),[12345,17]);assert.equal(f.sql.prepare('SELECT cap_cents FROM ocr_business_budget').get().cap_cents,null);
 f.sql.exec("INSERT INTO accounts(id,label,enabled) VALUES('c','c',1),('d','d',1);INSERT INTO identities VALUES('c@example.invalid','c'),('d@example.invalid','d')");for(const a of ['b','c','d'])await f.wallet.newOrder(a,unifiedPaymentConfig(f.env));const cap=f.sql.prepare('SELECT * FROM unified_capacity').get();assert.equal(cap.committed_cents,2000);assert.equal(unifiedCheckoutStatus(f.env,{email:f.env.OWNER_EMAIL,enabled:1},{available:true},null).configured,true);assert.equal(f.sql.prepare('SELECT prior_ocr_cap FROM provider_spending_policy_changes').get().prior_ocr_cap,1000);assert.throws(()=>f.sql.exec('DELETE FROM provider_spending_policy_changes'));
});
test('uncapped production OCR remains credit-bound and allows only one in-flight scan per account',async()=>{
 const f=fixture('production');await fund(f);uncap(f);f.sql.exec("UPDATE ocr_business_budget SET reserved_cents=5000");f.ocr('one',10);assert.equal((await f.wallet.balance('a')).held,20000);assert.throws(()=>f.ocr('two',1));assert.equal((await f.wallet.balance('a')).balance,980000);f.sql.prepare("INSERT INTO ocr_settlements(attempt,outcome,created) VALUES('one','uncertain',?)").run(now);f.ocr('two',1);assert.equal((await f.wallet.balance('a')).held,2000);assert.throws(()=>f.ocr('too-many-pages',11));assert.equal(f.sql.prepare('SELECT reserved_cents FROM ocr_business_budget').get().reserved_cents,5009);
});
test('uncapped speech preserves immutable one-attempt accounting beyond former daily/monthly ceilings',async()=>{
 const f=fixture('production');uncap(f);const day=new Date(now).toISOString().slice(0,10),month=day.slice(0,7);f.sql.prepare('INSERT INTO provider_periods VALUES(?,?)').run(day,2500000);f.sql.prepare('INSERT INTO provider_periods VALUES(?,?)').run(month,12500000);await dispatchBudget(f.db,'after-ceiling',0,'valid request',now);await assert.rejects(dispatchBudget(f.db,'after-ceiling',0,'valid request',now));const cap=await capacity(f.db,now);assert.equal(cap.available,true);assert.equal(cap.dailyRemaining,null);assert.equal(cap.monthlyRemaining,null);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM provider_attempts').get().n,1);assert.equal(f.sql.prepare('SELECT prior_speech_daily FROM provider_spending_policy_changes').get().prior_speech_daily,2500000);assert.equal(f.sql.prepare('SELECT prior_speech_monthly FROM provider_spending_policy_changes').get().prior_speech_monthly,12500000);
});
