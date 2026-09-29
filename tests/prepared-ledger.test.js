import {EmailIdentity,normalizeEmail} from '../cloudflare/prepared/identity.js';
import {admitJob} from '../cloudflare/prepared/admission.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {UsageLedger,sourceCounts} from '../cloudflare/prepared/ledger.js';
// Execute the same migration and SQL on real SQLite. The separate local API
// check covers workerd/D1 and competing requests, beyond this adapter.
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync('scripts/wavenet-worker-proof/migrations/0001_ledger.sql','utf8'));
 sql.exec(readFileSync('scripts/wavenet-worker-proof/migrations/0002_identity.sql','utf8'));
 sql.exec(readFileSync('scripts/wavenet-worker-proof/migrations/0003_payments.sql','utf8'));
 const db={prepare(text){return {bind(...values){return {first:async()=>sql.prepare(text).get(...values)||null,run:async()=>sql.prepare(text).run(...values)};}};},async batch(statements){sql.exec('BEGIN');try{for(const s of statements)await s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,ledger:new UsageLedger(db),identity:new EmailIdentity(db)};
}
const input={voice:'en-US-Wavenet-F',mode:'fixture',chunks:['A😀','字']};
test('credit uses Unicode code points and grants retain original purchased amounts',async()=>{
 const {sql,ledger}=setup();assert.deepEqual(sourceCounts(input.chunks),[2,1]);
 sql.exec("INSERT INTO grants VALUES('old-pack','test-reader-a',3000000); INSERT OR IGNORE INTO grants VALUES('old-pack','test-reader-a',1000000)");
 assert.equal((await ledger.account('test-reader-a')).balance,3005000);
 await ledger.reserve('job','test-reader-a',input);assert.equal((await ledger.account('test-reader-a')).reserved,3);sql.close();
});
test('sessions expire and revoke; storage contains only a hash',async()=>{
 const {sql,ledger}=setup();const token=await ledger.issueSession('test-reader-a',1000);
 assert.equal((await ledger.session(token,1001)).id,'test-reader-a');
 assert.notEqual(sql.prepare('SELECT token_hash FROM sessions').get().token_hash,token);
 assert.equal(await ledger.session(token,3601000),null);await ledger.logout(token);assert.equal(await ledger.session(token,1001),null);sql.close();
});
test('settlement replay is idempotent and uncertain sections are refunded',async()=>{
 const {sql,ledger}=setup();await ledger.reserve('job','test-reader-a',input);
 const job={id:'job',owner:'test-reader-a',state:'failed',parts:[{state:'ready'},{state:'submitting'}]};
 await ledger.settle(job);await ledger.settle(job);await ledger.reserve('job','test-reader-a',input);
 const receipt=await ledger.receipt('job','test-reader-a');assert.equal(receipt.consumed,2);assert.equal(receipt.released,1);assert.equal((await ledger.account('test-reader-a')).balance,4998);
 await assert.rejects(ledger.assertOpen('job','test-reader-a'));sql.close();
});
test('failed settlement transaction rolls back every charge and allows retry',async()=>{
 const {sql,ledger}=setup();await ledger.reserve('job','test-reader-a',input);
 sql.exec("CREATE TRIGGER break_settle BEFORE UPDATE OF state ON reservations BEGIN SELECT RAISE(ABORT,'synthetic database failure'); END");
 const job={id:'job',owner:'test-reader-a',state:'ready',parts:[{state:'ready'},{state:'ready'}]};
 await assert.rejects(ledger.settle(job));assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM usage').get().n,0);
 assert.equal((await ledger.receipt('job','test-reader-a')).remaining,3);
 sql.exec('DROP TRIGGER break_settle');await ledger.settle(job);assert.equal((await ledger.account('test-reader-a')).balance,4997);sql.close();
});
test('disabled account stops future batches while its reservation can settle',async()=>{
 const {sql,ledger}=setup();await ledger.reserve('job','test-reader-a',input);
 sql.exec("UPDATE accounts SET enabled=0 WHERE id='test-reader-a'");await assert.rejects(ledger.assertOpen('job','test-reader-a'));
 await ledger.settle({id:'job',owner:'test-reader-a',state:'cancelled',parts:[{state:'pending'},{state:'pending'}]});assert.equal((await ledger.account('test-reader-a')).balance,5000);sql.close();
});

function intent(){return {...input,id:'recover',owner:'test-reader-a',admission:'pending',state:'preparing',parts:input.chunks.map(()=>({state:'pending'}))};}
test('lost reservation response recovers against persisted intent without another debit',async()=>{
 const {sql,ledger}=setup();let stored=intent();const save=async j=>{stored=structuredClone(j);};
 await assert.rejects(admitJob(structuredClone(stored),{ledger,save,afterReserve:async()=>{throw Error('connection lost');}}));
 assert.equal(stored.admission,'pending');assert.equal((await ledger.account('test-reader-a')).balance,4997);
 const recovered=structuredClone(stored);await admitJob(recovered,{ledger,save});assert.equal(stored.admission,'accepted');
 assert.equal((await ledger.account('test-reader-a')).balance,4997);
 recovered.state='failed';await ledger.settle(recovered);assert.equal((await ledger.account('test-reader-a')).balance,5000);sql.close();
});
test('failure persisting accepted admission can retry from the prior durable intent',async()=>{
 const {sql,ledger}=setup(),stored=intent();
 await assert.rejects(admitJob(structuredClone(stored),{ledger,save:async()=>{throw Error('storage interrupted');}}));
 const recovered=structuredClone(stored);await admitJob(recovered,{ledger,save:async()=>{}});
 assert.equal(recovered.admission,'accepted');assert.equal((await ledger.account('test-reader-a')).reserved,3);sql.close();
});
test('insufficient credit durably rejects admission without a reservation',async()=>{
 const {sql,ledger}=setup();sql.exec("UPDATE accounts SET balance=0 WHERE id='test-reader-a'");
 const job=intent();let stored;await admitJob(job,{ledger,save:async j=>{stored=structuredClone(j);}});
 assert.equal(stored.admission,'rejected');assert.equal(stored.state,'failed');assert.equal(await ledger.receipt(job.id,job.owner),null);sql.close();
});
test('cancelled or expired intents cannot reserve credit on replay',async()=>{
 const {sql,ledger}=setup();for(const state of ['cancelled','expired']){
 const job={...intent(),state};await admitJob(job,{ledger,save:async()=>{throw Error('must not save');}});
 assert.equal(await ledger.receipt(job.id,job.owner),null);
 }assert.equal((await ledger.account('test-reader-a')).balance,5000);sql.close();
});
test('already closed reservation cannot restart preparation through admission recovery',async()=>{
 const {sql,ledger}=setup(),job=intent();await ledger.reserve(job.id,job.owner,job);
 await ledger.settle({...job,state:'cancelled'});await admitJob(job,{ledger,save:async()=>{}});
 assert.equal(job.state,'failed');assert.equal((await ledger.account('test-reader-a')).balance,5000);sql.close();
});

test('email confirmation preserves credit and independent verified sessions',async()=>{
 const {sql,identity,ledger}=setup();const old=await ledger.issueSession('test-reader-a');
 const link=await identity.request('Reader+tag@Example.invalid','test-reader-a','local');
 await assert.rejects(identity.confirm(link.token,'wrong'),e=>e.status===400);
 const session=await identity.confirm(link.token,link.flow);assert.equal((await ledger.session(session)).id,'test-reader-a');
 assert.equal(await ledger.session(old),null);assert.equal((await ledger.account('test-reader-a')).balance,5000);
 await assert.rejects(identity.confirm(link.token,link.flow),e=>e.status===400);
 const second=await identity.request('reader+tag@example.invalid',null,'local');const another=await identity.confirm(second.token,second.flow);
 await ledger.logout(session);assert.equal((await ledger.session(another)).id,'test-reader-a');
 assert.equal((await ledger.account('test-reader-a')).balance,5000);sql.close();
});
test('email conflicts protect credit, held credit and pending orders without consuming link',async()=>{
 for(const condition of ['balance','reservation','order']){
 const {sql,identity,ledger}=setup();const link=await identity.request('owner@example.invalid','test-reader-a','local');await identity.confirm(link.token,link.flow);
 if(condition==='reservation')await ledger.reserve('held','test-reader-b',{...input,chunks:['x'.repeat(5000)]});
 if(condition==='order'){sql.exec("UPDATE accounts SET balance=0 WHERE id='test-reader-b'; INSERT INTO orders(id,account,created) VALUES('pending','test-reader-b','now')");}
 const conflict=await identity.request('owner@example.invalid','test-reader-b','local');
 await assert.rejects(identity.confirm(conflict.token,conflict.flow),e=>e.status===409);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM login_links').get().n,1);sql.close();
 }
});
test('email expiry, rate limits, failed delivery and aliases retain existing semantics',async()=>{
 const {sql,identity}=setup();assert.equal(normalizeEmail('A.b+tag@EXAMPLE.invalid'),'a.b+tag@example.invalid');
 assert.throws(()=>normalizeEmail('injected\n@example.invalid'));
 const expired=await identity.request('old@example.invalid',null,'local',1000);
 await assert.rejects(identity.confirm(expired.token,expired.flow,901000),e=>e.status===400);
 for(let n=0;n<5;n++){const l=await identity.request('limited@example.invalid',null,'local',1000);await identity.cancel(l.token);}
 await assert.rejects(identity.request('limited@example.invalid',null,'local',1000),e=>e.status===429);
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM login_limits WHERE scope='global'").get().n,6);sql.close();
});
test('verified identity cannot be renamed and new email does not inherit its balance',async()=>{
 const {sql,identity,ledger}=setup();const first=await identity.request('one@example.invalid','test-reader-a','local');await identity.confirm(first.token,first.flow);
 const second=await identity.request('two@example.invalid','test-reader-a','local');const session=await identity.confirm(second.token,second.flow);
 const account=await ledger.session(session);assert.notEqual(account.id,'test-reader-a');assert.equal(account.balance,0);
 assert.equal((await ledger.account('test-reader-a')).balance,5000);sql.close();
});

test('payment replay, partial refund, reversal and legacy packs preserve entitlement',async()=>{
 for(const characters of [1000000,3000000]){
 const {sql,ledger}=setup();const order=await ledger.newOrder('test-reader-a');
 sql.prepare('UPDATE orders SET characters=? WHERE id=?').run(characters,order.id);
 await ledger.bindOrder(order.id,'txn_test');
 assert.equal(await ledger.syncPayment(order.id,'txn_test','completed'),true);
 assert.equal(await ledger.syncPayment(order.id,'txn_test','completed'),false);
 assert.equal((await ledger.account('test-reader-a')).balance,5000+characters);
 await ledger.syncPayment(order.id,'txn_test','completed',characters/2);
 await ledger.syncPayment(order.id,'txn_test','completed',characters/2);
 assert.equal((await ledger.account('test-reader-a')).balance,5000+characters/2);
 await ledger.paymentError(order.id);await ledger.syncPayment(order.id,'txn_test','completed',0);
 assert.equal((await ledger.account('test-reader-a')).balance,5000+characters);
 await assert.rejects(ledger.syncPayment(order.id,'txn_test','paid'));sql.close();
 }
});
test('refund debt stops generation, returned reservations and new purchases repay debt',async()=>{
 const {sql,ledger}=setup();const order=await ledger.newOrder('test-reader-a');await ledger.bindOrder(order.id,'txn_test');
 await ledger.syncPayment(order.id,'txn_test','completed');
 sql.exec("UPDATE accounts SET balance=100 WHERE id='test-reader-a'");
 await ledger.reserve('held','test-reader-a',input);
 await ledger.syncPayment(order.id,'txn_test','completed',1000000);
 assert.equal((await ledger.account('test-reader-a')).shortfall,999903);
 await assert.rejects(ledger.assertOpen('held','test-reader-a'));
 await ledger.settle({id:'held',owner:'test-reader-a',state:'cancelled',parts:[{state:'pending'},{state:'pending'}]});
 assert.equal((await ledger.account('test-reader-a')).shortfall,999900);
 const next=await ledger.newOrder('test-reader-a');await ledger.bindOrder(next.id,'txn_next');await ledger.syncPayment(next.id,'txn_next','completed');
 assert.equal((await ledger.account('test-reader-a')).balance,100);assert.equal((await ledger.account('test-reader-a')).shortfall,0);sql.close();
});
test('payment command failure rolls back grant and balance; pending order is reused',async()=>{
 const {sql,ledger}=setup();const a=await ledger.newOrder('test-reader-a'),b=await ledger.newOrder('test-reader-a');assert.equal(a.id,b.id);
 await ledger.bindOrder(a.id,'txn_test');sql.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON payment_sync BEGIN SELECT RAISE(ABORT,'failure'); END");
 await assert.rejects(ledger.syncPayment(a.id,'txn_test','completed'));assert.equal((await ledger.account('test-reader-a')).balance,5000);
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM grants WHERE id='txn_test'").get().n,0);sql.close();
});
