import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const dashboardBundle=await build({entryPoints:['cloudflare/reader/owner-dashboard.js'],bundle:true,write:false,format:'esm',platform:'node',keepNames:true});
const {ownerAccess,ownerReport,reportWindow}=await import('data:text/javascript;base64,'+Buffer.from(dashboardBundle.outputFiles[0].text).toString('base64'));
import {digest} from '../cloudflare/prepared/ledger.js';
const bundled=await build({entryPoints:['cloudflare/reader/worker.js'],bundle:true,write:false,format:'esm',platform:'node'});
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-09-29T12:00:00Z');
function setup(){
 const sql=new DatabaseSync(':memory:');
 for(const name of readdirSync('cloudflare/reader/migrations').filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync('cloudflare/reader/migrations/'+name,'utf8'));
 sql.exec(readFileSync('migrations/0001.sql','utf8'));
 sql.exec("INSERT INTO ocr_business_budget(id,cap_cents) VALUES('sandbox-retail',NULL)");
 const db={prepare(text){return {bind(...args){return {first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)})};}};}};
 sql.exec("INSERT INTO accounts VALUES('owner','Owner',1,100000),('customer','Customer',1,100000); INSERT INTO identities VALUES('owner@example.invalid','owner'),('customer@example.invalid','customer')");
 const env={LEDGER:db,DB:db,OWNER_EMAIL:'owner@example.invalid',READER_MODE:'production-public',READER_ORIGIN:'https://pastetospeech.com'};
 return {sql,db,env};
}
test('owner routes require a current verified enabled owner session and never fall through to assets',async()=>{
 const {sql,db,env}=setup();
 for(const [token,account,kind,expires] of [['owner','owner','verified',Date.now()+60000],['anonymous','owner','anonymous',Date.now()+60000],['other','customer','verified',Date.now()+60000],['expired','owner','verified',0]])sql.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await digest(token),account,expires,kind);
 env.ASSETS={fetch(){throw Error('must not serve public assets');}};
 for(const path of ['/api/owner','/api/owner/app.js','/api/owner/report']){
  for(const token of ['', 'anonymous','other','expired']){
   const response=await worker.fetch(new Request(env.READER_ORIGIN+path,{headers:{Cookie:'p2s_private_reader='+token}}),env,{});
   assert.equal(response.status,403);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
  }
 }
 assert.equal(await ownerAccess(db,'owner',''),false);
 assert.equal(await ownerAccess(db,'owner',env.OWNER_EMAIL),true);
 const req=(path,options={})=>worker.fetch(new Request(env.READER_ORIGIN+path,{...options,headers:{Cookie:'p2s_private_reader=owner',Origin:env.READER_ORIGIN,...options.headers}}),env,{});
 assert.equal((await req('/api/owner')).status,200);
 assert.equal((await req('/api/owner/report?period=invalid')).status,400);
 assert.equal((await req('/api/owner/report',{method:'POST'})).status,405);
 assert.equal((await req('/api/owner/report',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal((await req('/api/owner/report')).status,200);
 assert.equal(await (await req('/api/owner',{method:'HEAD'})).text(),'');
 sql.exec("UPDATE accounts SET enabled=0 WHERE id='owner'");assert.equal((await req('/api/owner')).status,403);sql.close();
});
test('report aggregates real SQL without mutations, excludes owner and sandbox purchases, and preserves reversals',async()=>{
 const {sql,env}=setup();
 function reading(id,account,created,outcome,consumed,publicJob=true){
  // Closed fixture rows avoid touching balances; actual schema constraints remain enabled.
  sql.prepare("INSERT INTO reservations(job,account,fingerprint,plan,total,remaining,state,outcome,created,consumed) VALUES(?,?,'f','[]',100,0,'closed',?,?,?)").run(id,account,outcome,created,consumed);
  if(publicJob)sql.prepare('INSERT INTO public_jobs VALUES(?,?)').run(id,account);
 }
 reading('owner-read','owner',now-1000,'ready',20);reading('customer-read','customer',now-1000,'ready',30);reading('failed','customer',now-2000,'failed',7);reading('old','customer',Date.parse('2026-09-20'),'ready',50);reading('fixture','customer',now-1000,'ready',99,false);
 for(const [id,account,environment] of [['paid','customer','live'],['refund','customer','live'],['mine','owner','live'],['sandbox','customer','sandbox']]){
  sql.prepare("INSERT INTO orders(id,account,created,status,environment) VALUES(?,?,?,'credited',?)").run(id,account,new Date(now-1000).toISOString(),environment);
 }
 sql.prepare("INSERT INTO payment_sync(order_id,checked,revoked,state) VALUES('refund',?,1000000,'completed')").run(now);
 sql.exec("INSERT INTO daily_events VALUES('2026-09-29','page_view','none','none','test',5,0),('2026-09-29','playback_start','browser','none','test',2,0),('2026-09-20','page_view','none','none','test',99,0)");
 const before=sql.prepare('SELECT total_changes() n').get().n;
 const report=await ownerReport(env,'week',now);
 assert.deepEqual(report.groups.customers,{accounts:1,activeAccounts:1,readings:2,characters:37,failures:1,preparing:0,purchases:2,reversedPurchases:1});
 assert.equal(report.groups.owner.readings,1);assert.equal(report.groups.owner.purchases,1);assert.equal(report.events.length,2);
 assert.equal(sql.prepare('SELECT total_changes() n').get().n,before);
 assert.doesNotMatch(JSON.stringify(report),/@|customer-read|owner-read/);sql.close();
});
test('UTC windows handle calendar boundaries and empty periods stay zero',async()=>{
 assert.equal(reportWindow('today',now).start,Date.parse('2026-09-29T00:00:00Z'));
 assert.equal(reportWindow('week',now).day,'2026-09-23');assert.equal(reportWindow('launch',now).day,'2026-09-28');assert.throws(()=>reportWindow('all',now));
 const {sql,env}=setup();const report=await ownerReport(env,'today',now);assert.equal(report.groups.customers.accounts,1);assert.equal(report.groups.customers.purchases,0);assert.deepEqual(report.events,[]);sql.close();
});
function purchase(sql,source,id,{account='customer',transaction=id,status='credited',environment='live',created=now-1000,revoked=0}={}){
 const table={speech:'orders',credits:'unified_orders',ocr:'ocr_orders'}[source];
 const sync={speech:'payment_sync',credits:'unified_payment_sync',ocr:'ocr_payment_sync'}[source];
 const columns=['id','account','transaction_id','created','status','environment'];
 const values=[id,account,transaction,new Date(created).toISOString(),status,environment];
 if(source!=='speech'){columns.push('price_id','product_id','amount','currency',source==='credits'?'units':'pages');values.push('price_fixture','product_fixture','1000','USD',source==='credits'?1000000:500);}
 sql.prepare(`INSERT INTO ${table}(${columns}) VALUES(${values.map(()=>'?')})`).run(...values);
 if(revoked)sql.prepare(`INSERT INTO ${sync}(order_id,checked,revoked,state) VALUES(?,?,?,'completed')`).run(id,now,revoked);
}
test('all purchase systems count once per payment, separate unknown identities, and include current reversals',async()=>{
 const {sql,env}=setup();
 sql.exec("INSERT INTO accounts VALUES('unknown','Old account',1,100000)");
 purchase(sql,'speech','legacy',{transaction:'same-payment'});
 purchase(sql,'credits','migrated',{transaction:'same-payment',revoked:1}); // partial reversal counts, no double purchase
 purchase(sql,'credits','credits');
 purchase(sql,'ocr','ocr',{revoked:500});
 purchase(sql,'credits','mine',{account:'owner'});
 purchase(sql,'ocr','unknown',{account:'unknown'});
 purchase(sql,'speech','no-id',{transaction:null});
 purchase(sql,'credits','no-id',{transaction:null}); // unrelated missing IDs must not collapse
 purchase(sql,'credits','pending',{status:'pending'});
 purchase(sql,'ocr','canceled',{status:'canceled'});
 purchase(sql,'ocr','sandbox',{environment:'sandbox'});
 purchase(sql,'credits','old',{created:Date.parse('2026-09-20')});
 purchase(sql,'credits','future',{created:now+1000});
 const before=sql.prepare('SELECT total_changes() n').get().n;
 const report=await ownerReport(env,'week',now);
 assert.equal(report.groups.customers.purchases,5);
 assert.equal(report.groups.customers.reversedPurchases,2);
 assert.equal(report.groups.owner.purchases,1);
 assert.equal(report.groups.unverified.accounts,1);
 assert.equal(report.groups.unverified.purchases,1);
 assert.equal(sql.prepare('SELECT total_changes() n').get().n,before);
 // Current reversal state, not an immutable "ever refunded" total.
 sql.prepare("UPDATE unified_payment_sync SET revoked=0 WHERE order_id='migrated'").run();
 assert.equal((await ownerReport(env,'week',now)).groups.customers.reversedPurchases,1);
 env.READER_MODE='staging';
 assert.equal((await ownerReport(env,'week',now)).groups.customers.purchases,1);
 sql.close();
});
test('cross-account transaction conflicts are not attributed to owner or verified customers',async()=>{
 const {sql,env}=setup();
 purchase(sql,'speech','owner-copy',{transaction:'conflict',account:'owner'});
 purchase(sql,'credits','customer-copy',{transaction:'conflict'});
 const report=await ownerReport(env,'week',now);
 assert.equal(report.groups.unverified.purchases,1);assert.equal(report.groups.owner.purchases,0);assert.equal(report.groups.customers.purchases,0);
 sql.close();
});
test('unknown public preparation accounts stay separate and payment health covers newer systems',async()=>{
 const {sql,env}=setup();sql.exec("INSERT INTO accounts VALUES('unknown','Old account',1,100000)");
 sql.prepare("INSERT INTO reservations(job,account,fingerprint,plan,total,remaining,state,outcome,created,consumed) VALUES('unknown-job','unknown','f','[]',100,0,'closed','ready',?,10)").run(now-1000);
 sql.exec("INSERT INTO public_jobs VALUES('unknown-job','unknown')");
 for(const [source,id] of [['speech','old'],['credits','new'],['ocr','scan']]){
  purchase(sql,source,id,{revoked:1});
  const prefix={speech:'',credits:'unified_',ocr:'ocr_'}[source];
  sql.prepare(`UPDATE ${prefix}payment_sync SET state='error' WHERE order_id=?`).run(id);
  sql.prepare(`INSERT INTO ${prefix}webhook_events(id,transaction_id,received) VALUES(?,?,?)`).run(id,id,now-300001);
 }
 sql.prepare("INSERT INTO unified_webhook_events(id,transaction_id,received,processed) VALUES('handled','handled',?,?)").run(now-600000,now);
 sql.prepare("INSERT INTO ocr_webhook_events(id,transaction_id,received) VALUES('recent','recent',?)").run(now);
 const report=await ownerReport(env,'today',now);
 assert.equal(report.groups.unverified.readings,1);assert.equal(report.groups.customers.readings,0);
 assert.equal(report.health.delayedWebhooks,3);assert.equal(report.health.paymentErrors,3);
 sql.close();
});
test('anonymous activity is not fabricated into customer counts or production-only attribution',async()=>{
 const {sql,env}=setup();
 sql.exec("INSERT INTO daily_events VALUES('2026-09-29','playback_start','browser','none','production-public',4,0),('2026-09-29','playback_start','browser','none','production-trial',3,0)");
 const report=await ownerReport(env,'today',now);
 assert.equal(report.events[0].count,7);assert.equal(report.groups.customers.accounts,1);assert.equal(report.groups.customers.activeAccounts,0);
 sql.close();
});
