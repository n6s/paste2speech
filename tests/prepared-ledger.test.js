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
 const db={prepare(text){return {bind(...values){return {first:async()=>sql.prepare(text).get(...values)||null,run:async()=>sql.prepare(text).run(...values)};}};},async batch(statements){sql.exec('BEGIN');try{for(const s of statements)await s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {sql,ledger:new UsageLedger(db)};
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
